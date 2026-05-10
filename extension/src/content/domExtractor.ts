// DOM selector generation and metadata extraction

import { isSensitiveField, isElementVisible, sanitizeText } from '../shared/privacy';
import { MAX_TEXT_LENGTH } from '../shared/constants';
import type { DomNode, BoundingBox } from '../shared/types';

/**
 * Generates a stable CSS selector for an element
 * Priority: ID > data-testid > aria-label+tag > classes+tag > CSS path
 */
export function generateSelector(element: Element): string {
  // Priority 1: ID attribute
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Priority 2: data-testid or data-cy attributes
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-cy');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Priority 3: aria-label + tag
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Priority 4: name attribute for form elements
  const name = element.getAttribute('name');
  if (name && (element instanceof HTMLInputElement || element instanceof HTMLButtonElement)) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  // Priority 5: class + tag (if classes exist)
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter(c => c.length > 0);
    if (classes.length > 0 && classes.length <= 3) {
      const classSelector = classes.map(c => `.${CSS.escape(c)}`).join('');
      return `${element.tagName.toLowerCase()}${classSelector}`;
    }
  }

  // Fallback: construct CSS path with nth-child
  return buildCssPath(element);
}

/**
 * Builds a CSS path using parent elements and nth-child selectors
 */
function buildCssPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  const maxDepth = 5; // Limit path depth to avoid overly long selectors

  while (current && current !== document.body && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();

    // Add nth-child if there are siblings of the same type
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = parent;
    depth++;
  }

  return path.join(' > ');
}

/**
 * Extracts relevant attributes from an element
 */
function extractRelevantAttributes(element: Element): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  // Standard attributes to capture
  const relevantAttrs = [
    'type',
    'placeholder',
    'href',
    'src',
    'alt',
    'title',
    'value',
    'aria-label',
    'aria-describedby',
    'role',
  ];

  for (const attr of relevantAttrs) {
    const value = element.getAttribute(attr);
    if (value !== null) {
      attributes[attr] = value;
    }
  }

  // Special handling for input elements
  if (element instanceof HTMLInputElement) {
    attributes.checked = element.checked;
    attributes.disabled = element.disabled;
    // Don't capture actual value for sensitive fields
    if (!isSensitiveField(element)) {
      attributes.currentValue = element.value;
    }
  }

  // Special handling for select elements
  if (element instanceof HTMLSelectElement) {
    attributes.selectedIndex = element.selectedIndex;
    attributes.disabled = element.disabled;
  }

  return attributes;
}

/**
 * Extracts a DomNode representation from an HTML element
 */
export function extractDomNode(element: Element): DomNode {
  const rect = element.getBoundingClientRect();
  const bbox: BoundingBox = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };

  const text = element.textContent?.trim() || null;
  const isSensitive = isSensitiveField(element as HTMLElement);

  return {
    selector: generateSelector(element),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    name: element.getAttribute('name'),
    text: text ? sanitizeText(text, MAX_TEXT_LENGTH) : null,
    attributes: extractRelevantAttributes(element),
    bbox,
    is_sensitive: isSensitive,
  };
}

/**
 * Gets all interactive elements in the page
 */
export function getInteractiveElements(maxElements: number = 100): Element[] {
  const selectors = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[onclick]',
    '[contenteditable="true"]',
  ];

  const elements = new Set<Element>();

  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    for (const el of found) {
      if (elements.size >= maxElements) {
        break;
      }
      if (isElementVisible(el)) {
        elements.add(el);
      }
    }
    if (elements.size >= maxElements) {
      break;
    }
  }

  return Array.from(elements);
}

/**
 * Gets the currently focused element's selector
 */
export function getFocusedSelector(): string | null {
  const focused = document.activeElement;
  if (!focused || focused === document.body) {
    return null;
  }
  return generateSelector(focused);
}
