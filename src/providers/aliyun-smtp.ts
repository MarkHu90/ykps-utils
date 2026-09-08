import nodemailer, { type Transporter } from "nodemailer";

import {
  EmailProviderError,
  type EmailProvider,
  type ProviderSendEmailRequest,
  type ProviderSendEmailResult,
} from "../email/service.js";

export interface AliyunSmtpProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export class AliyunSmtpProvider implements EmailProvider {
  readonly name = "aliyun-direct-mail-smtp";
  private readonly transporter: Transporter;

  constructor(options: AliyunSmtpProviderOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: { user: options.username, pass: options.password },
    });
  }

  async send(request: ProviderSendEmailRequest): Promise<ProviderSendEmailResult> {
    try {
      const result = await this.transporter.sendMail({
        from:
          request.displayName === undefined
            ? request.from
            : { address: request.from, name: request.displayName },
        to: [...request.to],
        subject: request.subject,
        ...(request.replyTo === undefined ? {} : { replyTo: request.replyTo }),
        ...(request.html === undefined ? {} : { html: request.html }),
        ...(request.text === undefined ? {} : { text: request.text }),
        attachments: request.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentDisposition: attachment.disposition,
          ...(attachment.contentType === undefined
            ? {}
            : { contentType: attachment.contentType }),
          ...(attachment.contentId === undefined ? {} : { cid: attachment.contentId }),
        })),
      });

      return {
        messageId: result.messageId,
        accepted: result.accepted.map(String),
        rejected: result.rejected.map(String),
      };
    } catch (error) {
      throw new EmailProviderError("Aliyun Direct Mail SMTP request failed.", {
        cause: error,
      });
    }
  }
}