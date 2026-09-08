import {
  loadAliyunSmtpOptions,
  loadAzureTranslatorOptions,
  loadEmailTemplateDefinitions,
  loadNotificationConfig,
} from "./config.js";
import { EmailService } from "./email/service.js";
import { EmailTemplateService } from "./email/template-service.js";
import {
  EmailNotificationProvider,
  WebhookNotificationProvider,
} from "./notification/providers.js";
import {
  NotificationService,
  type NotificationProvider,
} from "./notification/service.js";
import { AliyunSmtpProvider } from "./providers/aliyun-smtp.js";
import { AzureTranslatorProvider } from "./providers/azure-translator.js";
import { TranslationService } from "./translation/service.js";

export function createConfiguredTranslationService(
  environment: NodeJS.ProcessEnv = process.env,
): TranslationService {
  return new TranslationService(
    new AzureTranslatorProvider(loadAzureTranslatorOptions(environment)),
  );
}

export function createConfiguredEmailService(
  environment: NodeJS.ProcessEnv = process.env,
): EmailService {
  const options = loadAliyunSmtpOptions(environment);
  const templateDefinitions = loadEmailTemplateDefinitions(environment);
  return new EmailService(
    options === undefined ? undefined : new AliyunSmtpProvider(options),
    options?.username,
    templateDefinitions === undefined
      ? undefined
      : new EmailTemplateService(templateDefinitions),
  );
}

export function createConfiguredNotificationService(
  emailService: EmailService,
  environment: NodeJS.ProcessEnv = process.env,
): NotificationService | undefined {
  const config = loadNotificationConfig(environment);
  if (config === undefined) {
    return undefined;
  }

  const providers: NotificationProvider[] = config.channels.map((channel) => {
    if (channel.type === "email") {
      return new EmailNotificationProvider(
        channel.id,
        channel.recipients!,
        emailService,
      );
    }
    return new WebhookNotificationProvider({
      channelId: channel.id,
      channelType: channel.type,
      url: channel.url!,
      ...(channel.headers === undefined ? {} : { headers: channel.headers }),
    });
  });

  return new NotificationService(providers, config.routes, {
    ...(config.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: config.defaultTimeoutMs }),
    ...(config.retryDelayMs === undefined
      ? {}
      : { retryDelayMs: config.retryDelayMs }),
  });
}