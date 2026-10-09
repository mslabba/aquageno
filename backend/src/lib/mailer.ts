import { logger } from './logger';

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

class StubMailer implements Mailer {
  outbox: OutboundMail[] = [];

  async send(mail: OutboundMail): Promise<void> {
    this.outbox.push(mail);
    logger.info({ to: mail.to, subject: mail.subject }, 'stub mailer accepted a message');
  }
}

export const mailer = new StubMailer();
