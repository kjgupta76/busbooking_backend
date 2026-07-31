class CustomError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends CustomError {
  constructor(message) {
    super(message, 400);
  }
}

class TransactionError extends CustomError {
  constructor(message) {
    super(message, 500);
  }
}

class PaymentError extends CustomError {
  constructor(message, statusCode = 400) {
    super(message, statusCode);
  }
}

class SeatLockError extends CustomError {
  constructor(message) {
    super(message, 400);
  }
}

class BookingError extends CustomError {
  constructor(message, statusCode = 400) {
    super(message, statusCode);
  }
}

class RollbackError extends CustomError {
  constructor(message) {
    super(message, 500);
  }
}

// Attach static properties for easy destructuring from require()
CustomError.CustomError = CustomError;
CustomError.ValidationError = ValidationError;
CustomError.TransactionError = TransactionError;
CustomError.PaymentError = PaymentError;
CustomError.SeatLockError = SeatLockError;
CustomError.BookingError = BookingError;
CustomError.RollbackError = RollbackError;

module.exports = CustomError;
