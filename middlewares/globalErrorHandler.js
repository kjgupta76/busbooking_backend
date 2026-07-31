const CustomError = require("../utils/createCustomError");

const ErrorMiddleware = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || "Internal Server Error";

  // Default to development handler if not in production to prevent request hangs
  if (process.env.NODE_ENV === "production") {
    handleProductionError(err, res);
  } else {
    handleDevelopmentError(err, res);
  }
};

const handleDevelopmentError = (err, res) => {
  console.error("Development Error:", err);
  res.status(err.statusCode).json({
    success: false,
    message: err.message,
    error: {
      message: err.message,
      type: err.name || "Error",
      statusCode: err.statusCode,
      stack: err.stack,
    },
  });
};

const handleProductionError = (err, res) => {
  let errResponse = {
    statusCode: err.statusCode,
    message: err.message,
    name: err.name || "Error",
  };

  // Wrong Mongoose Object ID Error
  if (err.name === "CastError") {
    errResponse.message = `Resource not found. Invalid: ${err.path}`;
    errResponse.statusCode = 404;
    errResponse.name = "CastError";
  }

  // Handling Mongoose Validation Error
  else if (err.name === "ValidationError") {
    errResponse.message = Object.values(err.errors || {}).map((value) => value.message).join(", ");
    errResponse.statusCode = 400;
    errResponse.name = "ValidationError";
  }

  // Handle mongoose duplicate key error
  else if (err.code === 11000) {
    errResponse.message = `Duplicate ${Object.keys(err.keyValue || {}).join(", ")} entered.`;
    errResponse.statusCode = 400;
    errResponse.name = "DuplicateKeyError";
  }

  console.error("Production Error:", errResponse.message);

  res.status(errResponse.statusCode).json({
    success: false,
    message: errResponse.message,
    error: {
      message: errResponse.message,
      type: errResponse.name,
      statusCode: errResponse.statusCode,
    },
  });
};

module.exports = ErrorMiddleware;
