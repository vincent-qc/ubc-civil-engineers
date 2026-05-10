// Privacy filtering for sensitive fields

import {
  SENSITIVE_INPUT_TYPES,
  SENSITIVE_AUTOCOMPLETE_VALUES,
  SENSITIVE_NAME_PATTERNS,
  CONFIRMATION_KEYWORDS,
} from './constants';
import type { BrowserAction, BrowserObservation } from './types';

/**
 * Checks if an HTML element contains sensitive information that should not be captured
 */
export function isSensitiveField(element: HTMLElement): boolean {
  // Check input type
  if (element instanceof HTMLInputElement) {
    if (SENSITIVE_INPUT_TYPES.includes(element.type)) {
      return true;
    }
  }

  // Check autocomplete attribute
  const autocomplete = element.getAttribute('autocomplete')?.toLowerCase();
  if (autocomplete) {
    if (SENSITIVE_AUTOCOMPLETE_VALUES.some(val => autocomplete.includes(val))) {
      return true;
    }
  }

  // Check name and id attributes for sensitive patterns
  const nameId = (element.getAttribute('name') || element.id || '').toLowerCase();
  if (SENSITIVE_NAME_PATTERNS.some(pattern => nameId.includes(pattern))) {
    return true;
  }

  // Check aria-label for sensitive patterns
  const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
  if (SENSITIVE_NAME_PATTERNS.some(pattern => ariaLabel.includes(pattern))) {
    return true;
  }

  return false;
}

/**
 * Checks if an action requires user confirmation before execution
 */
export function requiresConfirmation(
  action: BrowserAction,
  observation: BrowserObservation
): boolean {
  // Check if it's a click action
  if (action.type !== 'click') {
    return false;
  }

  // Check button text for confirmation keywords
  const selector = action.selector?.toLowerCase() || '';
  const text = action.text?.toLowerCase() || '';

  if (CONFIRMATION_KEYWORDS.some(keyword => text.includes(keyword) || selector.includes(keyword))) {
    return true;
  }

  // Check URL for sensitive domains
  const url = observation.url.toLowerCase();
  const sensitiveDomains = ['bank', 'payment', 'checkout', 'paypal', 'stripe'];
  if (sensitiveDomains.some(domain => url.includes(domain))) {
    return true;
  }

  // Check if targeting a form submit button
  if (selector.includes('submit') || selector.includes('form')) {
    return true;
  }

  return false;
}

/**
 * Sanitizes text content to remove potential sensitive information
 */
export function sanitizeText(text: string, maxLength: number = 200): string {
  // Truncate text
  let sanitized = text.trim().slice(0, maxLength);

  // Remove potential credit card numbers (16 digits with optional spaces/dashes)
  sanitized = sanitized.replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, '[REDACTED]');

  // Remove potential SSN (XXX-XX-XXXX)
  sanitized = sanitized.replace(/\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/g, '[REDACTED]');

  // Remove potential email addresses if they look like personal info
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');

  return sanitized;
}

/**
 * Checks if an element is visible in the viewport
 */
export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  // Check if element has zero size
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  // Check if element is hidden via CSS
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  // Check if element is outside viewport
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  if (rect.bottom < 0 || rect.right < 0 || rect.top > windowHeight || rect.left > windowWidth) {
    return false;
  }

  return true;
}
