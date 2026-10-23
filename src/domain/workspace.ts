import type {
  MinMaxDataset,
  SupplierDataset,
  ValidationIssue,
  SupplierOverride,
  OrderQtyEdit,
  OrderSettings,
} from './types';
import type {
  BranchRegistry,
  SkuQuantityPolicy,
  RebalanceConfig,
  RebalanceProposal,
  AcceptedTransfer,
} from './rebalancing/types';
export interface RebalanceResultScope {
  skuCode?: string;
  branchId?: string;
}
export interface RebalanceWorkspace {
  registry: BranchRegistry;
  policies: SkuQuantityPolicy[];
  config: RebalanceConfig;
  proposal: RebalanceProposal | null;
  accepted: AcceptedTransfer[];
  acceptedRevision: number;
  selectedLineIds: string[];
  rejectedLineIds: string[];
  tab: 'routes' | 'conditions' | 'results' | 'priorities';
  query: string;
  resultScope?: RebalanceResultScope;
}
export interface ImportFileRef {
  fileId: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}
export interface WorkspaceFile extends ImportFileRef {
  bytes: ArrayBuffer;
}
export interface WorkspaceData {
  minMax: MinMaxDataset | null;
  suppliers: SupplierDataset | null;
  minMaxFileName: string | null;
  supplierFileName: string | null;
  minMaxIssues: ValidationIssue[];
  supplierIssues: ValidationIssue[];
  overrides: SupplierOverride[];
  edits: OrderQtyEdit[];
  settings: OrderSettings;
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
  page: string;
  rebalance: RebalanceWorkspace;
  uiPreferences: Record<string, unknown>;
  rawImports: { minMax: ImportFileRef | null; suppliers: ImportFileRef | null };
}
export interface ActiveWorkspace {
  workspaceId: string;
  revision: number;
}
export interface StoredWorkspace {
  schemaVersion: 1;
  workspaceId: string;
  revision: number;
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
  data: WorkspaceData;
  previousActive?: ActiveWorkspace;
}
export type WorkspaceMetadata = Pick<
  StoredWorkspace,
  'workspaceId' | 'revision' | 'snapshotId' | 'createdAt' | 'updatedAt'
> & { minMaxFileName: string | null; supplierFileName: string | null };
