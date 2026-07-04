const nodemailer = require("nodemailer");

const getEmailCredentials = () => {
  const user = (process.env.EMAIL_USER || "").trim();
  const pass = (process.env.EMAIL_PASS || "").replace(/\s/g, "");

  if (!user || !pass) {
    throw new Error("EMAIL_USER and EMAIL_PASS must be set in .env");
  }

  if (!user.includes("@")) {
    throw new Error(
      "EMAIL_USER must be a full Gmail address (e.g. yourname@gmail.com), not a username only"
    );
  }

  return { user, pass };
};

const sendVerificationMail = async (email, otp) => {
  const { user, pass } = getEmailCredentials();

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: user,
    to: email,
    subject: "Email Verification for Your App",
    text: `Your OTP for email verification is ${otp}. It is valid for 10 minutes.`,
  });
};

module.exports = { sendVerificationMail };
