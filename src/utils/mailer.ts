import nodemailer, { Transporter } from "nodemailer";
import path from "path";
import { welcomeEmailTemplate } from "../templates/welcomeEmail";

let transporter: Transporter;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

const ASSETS_DIR = path.join(__dirname, "..", "assets");

export async function sendWelcomeEmail(
  toEmail: string,
  fullName: string,
  password: string
): Promise<void> {
  const loginUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  const html = welcomeEmailTemplate({
    fullName,
    email: toEmail,
    password,
    loginUrl,
  });

  await getTransporter().sendMail({
    from: `"Effort Tracker - RhythmRX" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `Welcome to Effort Tracker, ${fullName}!`,
    html,
    attachments: [
      {
        filename: "rhythmrx-icon.png",
        path: path.join(ASSETS_DIR, "logo2.png.png"),
        cid: "rhythmrx-icon",
      },
    ],
  });
}
