const Otp = require("../models/otp");
const { userOtpMailValidate } = require("../utils/authUtils");
const { sendVerificationMail } = require("../utils/emailUtils");

const generateOtp = async ({ email }) => {
  console.log(email);
  try {
    await userOtpMailValidate({ email });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpRecord = await Otp.findOne({ email });

    if (otpRecord?.isEmailVerified) {
      return "This email is already verified. Please sign up or log in.";
    }

    if (otpRecord) {
      otpRecord.otp = otp;
      await otpRecord.save();
    } else {
      await new Otp({ email, otp }).save();
    }

    try {
      await sendVerificationMail(email, otp);
    } catch (mailError) {
      await Otp.deleteOne({ email, isEmailVerified: false });
      throw mailError;
    }

    return "Otp send to your Mail";
  } catch (error) {
    throw new Error(error.message || error);
  }
};

const verifyOtp = async ({ email, otp }) => {
  try {
    const otpRecord = await Otp.findOne({ email });
    if (!otpRecord) {
      return "User not found";
    }

    if (otpRecord.isEmailVerified) {
      return "OTP has already been verified.";
    }

    if (otpRecord.otp !== otp) {
      return "Incorrect OTP";
    }

    otpRecord.isEmailVerified = true;
    await otpRecord.save();

    return "Otp successfull verified";
  } catch (error) {
    throw new Error(error);
  }
};

module.exports = {
  generateOtp,
  verifyOtp,
};
