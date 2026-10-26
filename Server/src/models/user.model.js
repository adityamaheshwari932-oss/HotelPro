const mongoose = require('mongoose');

/**
 * User Schema
 *
 * Supports two roles: 'customer' and 'admin'.
 * Public registration assigns 'customer' by default.
 * Admin creation will be handled through a protected, one-time initialization workflow in Stage 3.
 *
 * NOTE ON PASSWORD HASHING:
 * Hashing belongs to the Authentication Service layer to keep business logic out of schemas.
 * The schema stores the pre-hashed string in `passwordHash` and marks it `select: false`
 * and strips it during JSON transformation so hashes are never leaked in API responses.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'User name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    role: {
      type: String,
      enum: {
        values: ['customer', 'admin'],
        message: 'Role must be either customer or admin'
      },
      default: 'customer',
      required: true
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive', 'suspended'],
        message: 'Status must be active, inactive, or suspended'
      },
      default: 'active',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Note: email uniqueness index is declared directly via unique: true on the field

// Sanitize output to prevent leaking password hashes and internal version keys
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  }
});

userSchema.set('toObject', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
