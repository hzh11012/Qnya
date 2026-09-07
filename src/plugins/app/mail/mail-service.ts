import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

interface SendMailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    mailService: ReturnType<typeof createMailService>;
  }
}

const createMailService = (
  fastify: FastifyInstance,
  transporter: Transporter<SMTPTransport.SentMessageInfo>
) => {
  const config = fastify.config;

  return {
    /**
     * 发送邮件
     */
    async send(options: SendMailOptions) {
      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html
      });
    },

    /**
     * 发送验证码邮件
     */
    async sendVerificationCode(email: string, code: string) {
      const subject = '【Qnya】登录验证码';
      const html = `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #333; text-align: center;">登录验证码</h2>
          <div style="background: #f5f5f5; padding: 30px; border-radius: 8px; text-align: center;">
            <p style="color: #666; margin-bottom: 20px;">您的验证码是：</p>
            <div style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 8px; margin: 20px 0;">
              ${code}
            </div>
            <p style="color: #999; font-size: 14px;">验证码有效期为 5 分钟，请勿泄露给他人。</p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
            如果这不是您的操作，请忽略此邮件。
          </p>
        </div>
      `;
      const text = `【Qnya】您的登录验证码是：${code}，有效期5分钟，请勿泄露给他人。`;

      await this.send({ to: email, subject, html, text });
    },

    /**
     * 验证 SMTP 连接
     */
    async verify() {
      await transporter.verify();
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const config = fastify.config;

    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      }
    });

    // 验证连接
    if (config.NODE_ENV === 'development') {
      try {
        await transporter.verify();
        fastify.log.info('SMTP connection verified');
      } catch (error) {
        fastify.log.warn(
          { error },
          'SMTP connection failed - emails will not be sent'
        );
      }
    }

    const service = createMailService(fastify, transporter);
    fastify.decorate('mailService', service);

    fastify.addHook('onClose', async () => {
      transporter.close();
      fastify.log.info('SMTP connection closed');
    });
  },
  {
    name: 'mail-service',
    dependencies: ['@fastify/env']
  }
);
