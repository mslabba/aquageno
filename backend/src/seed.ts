import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/prisma';
import { hashPassword } from './lib/password';
import { ACTIONS, MODULES, type ActionName, type ModuleName } from './lib/permissions';
import { businessToday } from './lib/dates';
import { loadUser } from './middleware/auth';
import type { AuthUser } from './types';
import * as docs from './services/documents';

const ALL = Object.fromEntries(MODULES.map((module) => [module, [...ACTIONS]])) as Record<ModuleName, ActionName[]>;

const MANAGER: Partial<Record<ModuleName, ActionName[]>> = {
  DASHBOARD: ['VIEW'],
  PURCHASES: [...ACTIONS],
  PRODUCTION: [...ACTIONS],
  STOCK: [...ACTIONS],
  TRANSFERS: [...ACTIONS],
  SHIPMENTS: [...ACTIONS],
  REPORTS: ['VIEW'],
  MASTER_DATA: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
  USERS: ['VIEW'],
  APPROVALS: ['VIEW', 'APPROVE'],
};

const STORE: Partial<Record<ModuleName, ActionName[]>> = {
  DASHBOARD: ['VIEW'],
  PURCHASES: ['VIEW', 'CREATE', 'EDIT'],
  PRODUCTION: ['VIEW', 'CREATE', 'EDIT'],
  STOCK: ['VIEW', 'CREATE', 'EDIT'],
  TRANSFERS: ['VIEW', 'CREATE', 'EDIT'],
  SHIPMENTS: ['VIEW', 'CREATE', 'EDIT'],
  REPORTS: ['VIEW'],
  MASTER_DATA: ['VIEW'],
  APPROVALS: ['VIEW'],
};

const VIEWER: Partial<Record<ModuleName, ActionName[]>> = Object.fromEntries(
  MODULES.map((module) => [module, ['VIEW']]),
) as Partial<Record<ModuleName, ActionName[]>>;

async function ensureRole(
  name: string,
  description: string,
  isSystem: boolean,
  grants: Partial<Record<ModuleName, ActionName[]>>,
) {
  const existing = await prisma.role.findUnique({ where: { name } });
  if (existing) return existing;
  const role = await prisma.role.create({ data: { name, description, isSystem } });
  const rows = MODULES.flatMap((module) =>
    (grants[module] ?? []).map((action) => ({ roleId: role.id, module, action })),
  );
  if (rows.length) await prisma.permission.createMany({ data: rows });
  return role;
}

async function ensureUser(email: string, name: string, password: string, roleName: string, mustChangePassword: boolean) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      roleId: role.id,
      mustChangePassword,
    },
  });
}

async function actor(email: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Seed user ${email} is missing`);
  const loaded = await loadUser(user.id);
  if (!loaded) throw new Error(`Seed user ${email} is inactive`);
  return loaded;
}

async function ensureUnit(code: string, name: string) {
  return prisma.unitOfMeasure.upsert({
    where: { code },
    update: {},
    create: { code, name },
  });
}

async function ensureCategory(name: string) {
  return prisma.itemCategory.upsert({ where: { name }, update: {}, create: { name } });
}

async function ensureWarehouse(code: string, name: string, address: string) {
  return prisma.warehouse.upsert({ where: { code }, update: {}, create: { code, name, address } });
}

async function ensureSupplier(input: {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
}) {
  return prisma.supplier.upsert({ where: { code: input.code }, update: {}, create: input });
}

async function ensureCustomer(input: {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
}) {
  return prisma.customer.upsert({ where: { code: input.code }, update: {}, create: input });
}

async function ensureItem(input: {
  sku: string;
  name: string;
  itemType: 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'FINISHED_GOOD';
  categoryId: string;
  unitId: string;
  reorderLevel: string;
  standardCost: string;
}) {
  return prisma.item.upsert({ where: { sku: input.sku }, update: {}, create: input });
}

async function postedPurchase(
  seedKey: string,
  input: Parameters<typeof docs.createPurchase>[0],
  maker: AuthUser,
  approver: AuthUser,
) {
  let doc: { id: string; status: string } = await docs.createPurchase(input, maker, seedKey);
  if (doc.status === 'DRAFT') doc = await docs.submitPurchase(doc.id, maker);
  if (doc.status === 'PENDING_APPROVAL') doc = await docs.approvePurchase(doc.id, approver, 'Opening stock');
  return doc;
}

export async function seed() {
  await ensureRole('Admin', 'Full access to every module. Cannot be removed.', true, ALL);
  await ensureRole('Manager', 'Runs the plant, approves documents, and maintains master data.', false, MANAGER);
  await ensureRole('Storekeeper', 'Records purchases, production, transfers, shipments, and adjustments.', false, STORE);
  await ensureRole('Viewer', 'Reads records and reports.', false, VIEWER);

  await ensureUser('admin@aquageno.local', 'Aquageno Admin', 'ChangeMe!2026', 'Admin', true);
  await ensureUser('meera.nair@aquageno.local', 'Meera Nair', 'Harbour!2026', 'Manager', false);
  await ensureUser('rafi.khan@aquageno.local', 'Rafi Khan', 'Harbour!2026', 'Storekeeper', false);
  await ensureUser('leela.dsouza@aquageno.local', 'Leela D Souza', 'Harbour!2026', 'Viewer', false);

  const kg = await ensureUnit('KG', 'Kilogram');
  const pcs = await ensureUnit('PCS', 'Piece');
  const crust = await ensureCategory('Crustaceans');
  const ceph = await ensureCategory('Cephalopods');
  const pelagic = await ensureCategory('Pelagic fish');
  const pack = await ensureCategory('Packaging');
  const ice = await ensureCategory('Consumables');

  const kochi = await ensureWarehouse('WH-KOCHI', 'Kochi Cold Store', 'Willingdon Island, Kochi');
  await ensureWarehouse('WH-VERAVAL', 'Veraval Plant', 'Fishing Harbour Road, Veraval');
  const mumbai = await ensureWarehouse('WH-MUMBAI', 'Mumbai Dispatch', 'Taloja MIDC, Navi Mumbai');

  const malabar = await ensureSupplier({
    code: 'SUP-MMC',
    name: 'Malabar Marine Catch',
    contactName: 'Joseph Mathew',
    phone: '+91 484 266 0144',
    email: 'accounts@malabarmarine.example',
    address: 'Thoppumpady, Kochi',
    gstin: '32AABCM1234R1Z5',
  });
  const kutch = await ensureSupplier({
    code: 'SUP-KCC',
    name: 'Kutch Ice & Cold Chain',
    contactName: 'Farida Memon',
    phone: '+91 2876 220 118',
    email: 'desk@kutchice.example',
    address: 'Kandla Port Road, Gandhidham',
    gstin: '24AABCK1234R1Z8',
  });
  const coastal = await ensureSupplier({
    code: 'SUP-CPP',
    name: 'Coastal Packs Pvt Ltd',
    contactName: 'Anand Shetty',
    phone: '+91 824 241 9088',
    email: 'sales@coastalpacks.example',
    address: 'Baikampady Industrial Area, Mangaluru',
    gstin: '29AABCC1234R1Z6',
  });
  const harbour = await ensureCustomer({
    code: 'CUS-HCE',
    name: 'Harbour & Co. Exports',
    contactName: 'Nithin Pai',
    phone: '+91 484 401 2200',
    email: 'buying@harbourco.example',
    address: 'Marine Drive, Kochi',
    gstin: '32AABCH1234R1Z3',
  });
  await ensureCustomer({
    code: 'CUS-TSR',
    name: 'Taj Sea Retail',
    contactName: 'Pooja Kulkarni',
    phone: '+91 22 4056 1180',
    email: 'stores@tajsea.example',
    address: 'Crawford Market, Mumbai',
    gstin: '27AABCT1234R1Z2',
  });
  await ensureCustomer({
    code: 'CUS-CBT',
    name: 'Colombo Bay Traders',
    contactName: 'Ruwan Perera',
    phone: '+94 11 234 8801',
    email: 'imports@colombobay.example',
    address: 'Pettah, Colombo',
    gstin: '',
  });

  const vannamei = await ensureItem({
    sku: 'RM-VAN-3140',
    name: 'Raw vannamei 31/40',
    itemType: 'RAW_MATERIAL',
    categoryId: crust.id,
    unitId: kg.id,
    reorderLevel: '200.000',
    standardCost: '420.00',
  });
  await ensureItem({
    sku: 'RM-VAN-4150',
    name: 'Raw vannamei 41/50',
    itemType: 'RAW_MATERIAL',
    categoryId: crust.id,
    unitId: kg.id,
    reorderLevel: '0.000',
    standardCost: '390.00',
  });
  const tiger = await ensureItem({
    sku: 'RM-BT-1315',
    name: 'Black tiger 13/15',
    itemType: 'RAW_MATERIAL',
    categoryId: crust.id,
    unitId: kg.id,
    reorderLevel: '50.000',
    standardCost: '680.00',
  });
  const squid = await ensureItem({
    sku: 'RM-SQU-WHL',
    name: 'Whole squid',
    itemType: 'RAW_MATERIAL',
    categoryId: ceph.id,
    unitId: kg.id,
    reorderLevel: '100.000',
    standardCost: '260.00',
  });
  const mackerel = await ensureItem({
    sku: 'RM-MAK-WHL',
    name: 'Indian mackerel',
    itemType: 'RAW_MATERIAL',
    categoryId: pelagic.id,
    unitId: kg.id,
    reorderLevel: '80.000',
    standardCost: '180.00',
  });
  const carton = await ensureItem({
    sku: 'PK-CTN-2KG',
    name: '2 kg printed carton',
    itemType: 'PACKING_MATERIAL',
    categoryId: pack.id,
    unitId: pcs.id,
    reorderLevel: '500.000',
    standardCost: '18.00',
  });
  const label = await ensureItem({
    sku: 'PK-LBL-VAN',
    name: 'Vannamei carton label',
    itemType: 'PACKING_MATERIAL',
    categoryId: pack.id,
    unitId: pcs.id,
    reorderLevel: '400.000',
    standardCost: '2.50',
  });
  const pouch = await ensureItem({
    sku: 'PK-POLY-1KG',
    name: '1 kg poly pouch',
    itemType: 'PACKING_MATERIAL',
    categoryId: pack.id,
    unitId: pcs.id,
    reorderLevel: '0.000',
    standardCost: '3.20',
  });
  const flake = await ensureItem({
    sku: 'CS-ICE',
    name: 'Flake ice',
    itemType: 'RAW_MATERIAL',
    categoryId: ice.id,
    unitId: kg.id,
    reorderLevel: '300.000',
    standardCost: '4.00',
  });
  const packedVan = await ensureItem({
    sku: 'FG-VAN-2KG',
    name: 'Packed vannamei 2 kg',
    itemType: 'FINISHED_GOOD',
    categoryId: crust.id,
    unitId: pcs.id,
    reorderLevel: '20.000',
    standardCost: '980.00',
  });
  const packedSquid = await ensureItem({
    sku: 'FG-SQU-1KG',
    name: 'Packed squid 1 kg',
    itemType: 'FINISHED_GOOD',
    categoryId: ceph.id,
    unitId: pcs.id,
    reorderLevel: '0.000',
    standardCost: '420.00',
  });
  await ensureItem({
    sku: 'FG-MAK-1KG',
    name: 'Packed mackerel 1 kg',
    itemType: 'FINISHED_GOOD',
    categoryId: pelagic.id,
    unitId: pcs.id,
    reorderLevel: '0.000',
    standardCost: '240.00',
  });

  const bomName = 'Vannamei 2 kg pack';
  const existingBom = await prisma.bom.findFirst({ where: { name: bomName, finishedItemId: packedVan.id } });
  if (!existingBom) {
    await prisma.bom.create({
      data: {
        name: bomName,
        finishedItemId: packedVan.id,
        lines: {
          create: [
            { itemId: vannamei.id, qtyPerUnit: new Prisma.Decimal('2.000'), sortOrder: 0 },
            { itemId: carton.id, qtyPerUnit: new Prisma.Decimal('1.000'), sortOrder: 1 },
            { itemId: label.id, qtyPerUnit: new Prisma.Decimal('1.000'), sortOrder: 2 },
            { itemId: flake.id, qtyPerUnit: new Prisma.Decimal('0.500'), sortOrder: 3 },
          ],
        },
      },
    });
  }
  const squidBom = 'Squid 1 kg pouch';
  if (!(await prisma.bom.findFirst({ where: { name: squidBom, finishedItemId: packedSquid.id } }))) {
    await prisma.bom.create({
      data: {
        name: squidBom,
        finishedItemId: packedSquid.id,
        lines: {
          create: [
            { itemId: squid.id, qtyPerUnit: new Prisma.Decimal('1.100'), sortOrder: 0 },
            { itemId: pouch.id, qtyPerUnit: new Prisma.Decimal('1.000'), sortOrder: 1 },
          ],
        },
      },
    });
  }

  const maker = await actor('rafi.khan@aquageno.local');
  const approver = await actor('meera.nair@aquageno.local');
  const today = businessToday();

  await postedPurchase(
    'seed-purchase-raw',
    {
      supplierId: malabar.id,
      invoiceNo: 'MMC-2609-11',
      invoiceDate: today,
      warehouseId: kochi.id,
      notes: 'Morning landing from Thoppumpady boats.',
      lines: [
        { itemId: vannamei.id, quantity: '500.000', unitPrice: '415.00' },
        { itemId: squid.id, quantity: '200.000', unitPrice: '250.00' },
        { itemId: mackerel.id, quantity: '150.000', unitPrice: '170.00' },
      ],
    },
    maker,
    approver,
  );

  await postedPurchase(
    'seed-purchase-packs',
    {
      supplierId: coastal.id,
      invoiceNo: 'CPP-2609-04',
      invoiceDate: today,
      warehouseId: kochi.id,
      notes: 'Cartons and labels for the vannamei line.',
      lines: [
        { itemId: carton.id, quantity: '300.000', unitPrice: '18.00' },
        { itemId: label.id, quantity: '300.000', unitPrice: '2.50' },
        { itemId: pouch.id, quantity: '400.000', unitPrice: '3.20' },
      ],
    },
    maker,
    approver,
  );

  await postedPurchase(
    'seed-purchase-ice',
    {
      supplierId: kutch.id,
      invoiceNo: 'KCC-2609-02',
      invoiceDate: today,
      warehouseId: kochi.id,
      notes: 'Flake ice for the pack room.',
      lines: [{ itemId: flake.id, quantity: '200.000', unitPrice: '4.00' }],
    },
    maker,
    approver,
  );

  let production: { id: string; status: string } = await docs.createProduction(
    {
      finishedItemId: packedVan.id,
      quantity: '80.000',
      batchNo: 'BATCH-2609-A',
      producedOn: today,
      warehouseId: kochi.id,
      notes: 'Morning pack of 2 kg vannamei cartons.',
      lines: [
        { itemId: vannamei.id, quantity: '160.000' },
        { itemId: carton.id, quantity: '80.000' },
        { itemId: label.id, quantity: '80.000' },
        { itemId: flake.id, quantity: '40.000' },
      ],
    },
    maker,
    'seed-production-van',
  );
  if (production.status === 'DRAFT') production = await docs.submitProduction(production.id, maker);
  if (production.status === 'PENDING_APPROVAL') {
    await docs.approveProduction(production.id, approver, 'Yield checked on the floor');
  }

  let pendingPurchase: { id: string; status: string } = await docs.createPurchase(
    {
      supplierId: malabar.id,
      invoiceNo: 'MMC-2609-18',
      invoiceDate: today,
      warehouseId: kochi.id,
      notes: 'Black tiger held for manager approval.',
      lines: [{ itemId: tiger.id, quantity: '40.000', unitPrice: '670.00' }],
    },
    maker,
    'seed-purchase-tiger',
  );
  if (pendingPurchase.status === 'DRAFT') {
    await docs.submitPurchase(pendingPurchase.id, maker);
  }

  let pendingShipment: { id: string; status: string } = await docs.createShipment(
    {
      customerId: harbour.id,
      shipmentDate: today,
      warehouseId: kochi.id,
      vehicleNo: 'KL-07-AB-4418',
      notes: 'Export lot waiting for dispatch approval.',
      lines: [{ itemId: packedVan.id, quantity: '20.000', unitPrice: '1250.00' }],
    },
    maker,
    'seed-shipment-harbour',
  );
  if (pendingShipment.status === 'DRAFT') {
    await docs.submitShipment(pendingShipment.id, maker);
  }

  await docs.createTransfer(
    {
      sourceWarehouseId: kochi.id,
      destinationWarehouseId: mumbai.id,
      transferDate: today,
      notes: 'Squid staged for the Mumbai counter. Not posted.',
      lines: [{ itemId: squid.id, quantity: '50.000' }],
    },
    maker,
    'seed-transfer-squid',
  );

  await docs.createAdjustment(
    {
      warehouseId: kochi.id,
      adjustmentDate: today,
      reason: 'DAMAGE',
      notes: 'Two kilograms crushed in the receiving tote.',
      lines: [{ itemId: mackerel.id, quantity: '2.000', direction: 'OUT' }],
    },
    maker,
    'seed-adjustment-mackerel',
  );
}

if (require.main === module) {
  seed()
    .then(async () => {
      await prisma.$disconnect();
      console.log('Seed complete');
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
