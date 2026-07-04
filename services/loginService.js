const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user");

const userLogin = async ({ email, password }) => {
  if (!email || !password) {
    throw new Error("Please enter your email and password");
  }
  try {
    const user = await userModel.findOne({ email });

    if (!user) {
      throw new Error("User does not exist");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error("Invalid credentials");
    }

    const tokenData = {
      userId: user._id,
    };

    const token = await jwt.sign(tokenData, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    return token;
  } catch (error) {
    throw new Error(error.message || "Unknown error occurred during login");
  }
};

module.exports = { userLogin };
