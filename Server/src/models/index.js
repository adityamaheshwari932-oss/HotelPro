const Hotel = require('./hotel.model');
const User = require('./user.model');
const Room = require('./room.model');
const Booking = require('./booking.model');
const Payment = require('./payment.model');
const SystemLock = require('./systemLock.model');
const WebhookEvent = require('./webhookEvent.model');

module.exports = {
  Hotel,
  User,
  Room,
  Booking,
  Payment,
  SystemLock,
  WebhookEvent
};
