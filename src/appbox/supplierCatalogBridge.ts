/** AppBoxFiles is injected by AppBox at runtime. Ordinary offline builds have no bridge. */
export interface AppBoxDocumentRef {
  canEdit?: boolean;
  [key: string]: unknown;
}
interface OpenedAppBoxFile {
  content: unknown;
  document: AppBoxDocumentRef | null;
}
interface SavedAppBoxFile {
  destination: 'appbox' | 'computer';
  document?: AppBoxDocumentRef | null;
}
export interface AppBoxFilesBridge {
  open(): Promise<OpenedAppBoxFile | null>;
  save(content: unknown, options: {
    filename: string;
    document: AppBoxDocumentRef | null;
  }): Promise<SavedAppBoxFile | null>;
}
declare global {
  interface Window {
    AppBoxFiles?: AppBoxFilesBridge;
  }
}
export interface SharedCatalogLink {
  document: AppBoxDocumentRef | null;
  /** Canonical snapshot last loaded from, or saved to, AppBox. */
  baseline: string;
}

/** Transient link deliberately does not persist across reload: the operator must re-open
 * the document, obtaining a fresh access grant and revision before saving again. */
let link: SharedCatalogLink | null = null;
export function appBoxFiles(): AppBoxFilesBridge | null {
  return typeof window === 'undefined' ? null : window.AppBoxFiles ?? null;
}
export function currentCatalogLink(): SharedCatalogLink | null { return link; }
export function rememberCatalogLink(next: SharedCatalogLink | null): void { link = next; }
