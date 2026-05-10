// Shared constants across extension components

export const API_BASE_URL = 'http://localhost:8000';

export const DEFAULT_USER_DISPLAY_NAME = 'Demo User';

// Event buffer settings
export const MAX_BUFFER_SIZE = 100;
export const BATCH_SIZE = 10;
export const FLUSH_INTERVAL_MS = 30000; // 30 seconds
export const MAX_BUFFER_AGE_MS = 300000; // 5 minutes

// Event throttling settings (milliseconds)
export const THROTTLE_SCROLL_MS = 1000; // 1 event per second
export const THROTTLE_INPUT_MS = 500; // 2 events per second
export const THROTTLE_RESIZE_MS = 2000; // 1 event per 2 seconds

// DOM extraction limits
export const MAX_DOM_NODES = 100;
export const MAX_TEXT_LENGTH = 200;
export const MAX_VISIBLE_TEXT_LENGTH = 5000;

// Retry settings
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;

// Sensitive field patterns
export const SENSITIVE_INPUT_TYPES = ['password', 'hidden'];

export const SENSITIVE_AUTOCOMPLETE_VALUES = [
  'current-password',
  'new-password',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'one-time-code',
];

export const SENSITIVE_NAME_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'ssn',
  'cvv',
  'cvc',
  'card-number',
  'credit-card',
  'bank-account',
  'pin',
  'otp',
  'token',
  'secret',
];

export const CONFIRMATION_KEYWORDS = [
  'submit',
  'send',
  'delete',
  'remove',
  'buy',
  'purchase',
  'checkout',
  'pay',
  'payment',
  'order',
  'confirm',
];
