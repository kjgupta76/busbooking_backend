const bcrypt = require("bcryptjs");
const { userDataValidation } = require("../utils/authUtils");
const userModel = require("../models/user");

const userSignUp = async (userData) => {
  const { fullName, gender, dob, email, contactNumber, password } = userData;
  // console.log(userData);
  try {
    await userDataValidation({
      fullName,
      gender,
      email,
      contactNumber,
      password,
    });
    // console.log(userData);
    const existingUser = await userModel.findOne({ email });

    if (existingUser) {
      throw new Error("User already exists with this email");
    }

    const hashedPassword = await bcrypt.hash(
      password,
      parseInt(process.env.SALT)
    );

    const newUser = new userModel({
      fullName,
      gender,
      dob,
      email,
      contactNumber,
      password: hashedPassword,
    });

    await newUser.save();

    return "User registered successfully.";
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      throw new Error("User already exists with this email");
    }

    throw new Error(error.message || error);
  }
};

module.exports = { userSignUp };
