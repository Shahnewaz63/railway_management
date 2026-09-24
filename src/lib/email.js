const nodemailer = require("nodemailer");

function isGmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function createGmailTransport() {
  if (!isGmailConfigured()) throw new Error("Gmail SMTP credentials are not configured.");
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, ""),
    },
  });
}

async function sendPasswordResetCode(to, firstName, code) {
  const transport = createGmailTransport();
  await transport.sendMail({
    from: { name: "RailX BD", address: process.env.GMAIL_USER },
    to,
    subject: "Your RailX BD password reset code",
    text: `Hello ${firstName},\n\nYour password reset code is ${code}. It expires in 10 minutes and can only be used once. If you did not request a reset, you can ignore this email.\n\nRailX BD`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#172c38"><h2 style="color:#0b6b4f">Reset your RailX BD password</h2><p>Hello ${escapeHtml(firstName)},</p><p>Use this code to choose a new password:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px;color:#0b6b4f">${code}</p><p>This code expires in 10 minutes and can only be used once. If you did not request a reset, ignore this email.</p></div>`,
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

module.exports = { isGmailConfigured, sendPasswordResetCode };
