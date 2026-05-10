// Builds BrowserObservation snapshots from current page state

import { extractDomNode, getInteractiveElements, getFocusedSelector } from './domExtractor';
import { sanitizeText } from '../shared/privacy';
import { MAX_DOM_NODES, MAX_VISIBLE_TEXT_LENGTH } from '../shared/constants';
import type { BrowserObservation } from '../shared/types';

/**
 * Extracts visible text from the page
 */
function getVisibleText(): string {
  // Get text from body, excluding script and style tags
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip script, style, and hidden elements
        const tagName = parent.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        // Only accept nodes with meaningful text
        const text = node.textContent?.trim() || '';
        if (text.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textParts: string[] = [];
  let totalLength = 0;
  let node: Node | null;

  while ((node = walker.nextNode()) && totalLength < MAX_VISIBLE_TEXT_LENGTH) {
    const text = node.textContent?.trim() || '';
    if (text) {
      textParts.push(text);
      totalLength += text.length;
    }
  }

  return sanitizeText(textParts.join(' '), MAX_VISIBLE_TEXT_LENGTH);
}

/**
 * Builds a complete BrowserObservation from the current page state
 */
export function buildObservation(): BrowserObservation {
  const url = window.location.href;
  const title = document.title;
  const visibleText = getVisibleText();
  const focusedSelector = getFocusedSelector();

  // Extract interactive elements
  const interactiveElements = getInteractiveElements(MAX_DOM_NODES);
  const domNodes = interactiveElements.map(el => extractDomNode(el));

  return {
    url,
    title,
    visible_text: visibleText,
    focused_selector: focusedSelector,
    dom_nodes: domNodes,
    metadata: {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
      dom_node_count: domNodes.length,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Builds a minimal observation (useful for frequent events like scroll)
 */
export function buildMinimalObservation(): BrowserObservation {
  return {
    url: window.location.href,
    title: document.title,
    visible_text: '',
    dom_nodes: [],
    metadata: {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
      timestamp: new Date().toISOString(),
    },
  };
}
