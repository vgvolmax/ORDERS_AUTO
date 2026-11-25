import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { PurchasingDataAlert } from '../../components/PurchasingDataAlert';
import { Button, EmptyState } from '../../components/ui';
import type { CatalogBase } from '../../domain/catalogChange';
import {
  applySupplierAssignmentChange,
  type SupplierAssignment,
  type SupplierAssignmentCommand,
} from '../../domain/supplierAssignments';
import { SUPPLIER_POOL } from '../../domain/supplierPool';
import { currentCatalogLink } from '../../appbox/supplierCatalogBridge';
import { SharedCatalogPanel } from './SharedCatalogPanel';
import { changeCatalogAssignment, type CatalogProduct } from '../../domain/supplierCatalog';
import { CatalogProductDialog } from './CatalogProductDialog';
import { BulkSupplierDialog, ProductSupplierDialog } from './SupplierAssignmentDialogs';
import {
  SupplierProducts,
  defaultProductFilters,
  type ProductFilters,
  type SupplierRole,
} from './SupplierProducts';
import { SupplierRoster } from './SupplierRoster';
import './SuppliersPage.css';

type AssignmentDialog = { skuCode: string } | { skuCodes: string[]; visibleCodes: string[] };
interface SupplierSelection {
  snapshotId: string;
  skuCodes: string[];
}

export function SuppliersPage() {
  const { state, shared } = useStore();
  const catalogMode = shared?.catalogRevision != null;
  return (
    <main className="suppliers-page compact-workspace">
      <header>
        <p className="eyebrow">Закупка</p>
        <h1>Поставщики</h1>
        {!catalogMode && <p>Постоянный справочник товаров и поставщиков. Назначения сохраняются независимо от рабочих сеансов.</p>}
      </header>
      <SharedCatalogPanel compact />
      {!state.catalog && state.supplierAssignments === undefined ? (
        !shared && <EmptyState>Загрузите отчёты, чтобы открыть каталог и связи поставщиков.</EmptyState>
      ) : (
        <SupplierWorkspace key={state.workspaceId} assignments={state.catalog?.assignments ?? state.supplierAssignments ?? []} />
      )}
    </main>
  );
}

function SupplierWorkspace({
  assignments,
}: {
  assignments: SupplierAssignment[];
}) {
  const { state, set, commit, shared } = useStore();
  const catalogMode = shared?.catalogRevision != null;
  const readOnly = shared?.catalogReadOnly ?? (currentCatalogLink()?.document?.canEdit === false);
  const derived = useDerivedState(state);
  const [view, setView] = useState<'products' | 'inactive' | 'suppliers'>('products');
  const [filters, setFilters] = usePreference<ProductFilters>(
    'suppliers:productFilters',
    defaultProductFilters,
  );
  const [inactiveFilters, setInactiveFilters] = usePreference<ProductFilters>(
    'suppliers:inactiveProductFilters',
    defaultProductFilters,
  );
  const [selection, setSelection] = usePreference<SupplierSelection | null>(
    'suppliers:selectedCodes',
    null,
  );
  const [dialog, setDialog] = useState<AssignmentDialog | null>(null);
  const [productEditor, setProductEditor] = useState<{ product?: CatalogProduct; base: CatalogBase } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const productTab = useRef<HTMLButtonElement>(null);
  const products = state.catalog?.products ?? state.minMax?.skus;
  const suppliers = state.catalog?.suppliers ?? SUPPLIER_POOL;
  const currentCodes = useMemo(() => new Set(state.minMax?.skus.map((sku) => sku.code)), [state.minMax]);
  const inactiveCount = useMemo(
    () => products?.filter((sku) => !currentCodes.has(sku.code)).length ?? 0,
    [products, currentCodes],
  );
  const productsByCode = useMemo(
    () => new Map(products?.map((sku) => [sku.code, sku])),
    [products],
  );
  const assignmentsByCode = useMemo(
    () => new Map(assignments.map((assignment) => [assignment.skuCode, assignment])),
    [assignments],
  );
  const selectedCodes = useMemo(
    () => selection?.snapshotId === state.snapshotId
    ? selection.skuCodes.filter((skuCode) => productsByCode.has(skuCode) && (catalogMode || currentCodes.has(skuCode)))
      : [],
    [productsByCode, currentCodes, catalogMode, selection, state.snapshotId],
  );
  const demandCodes = useMemo(
    () => new Set(derived.purchaseDemand.filter((line) => line.purchaseQty > 0).map((line) => line.skuCode)),
    [derived.purchaseDemand],
  );
  const product = dialog && 'skuCode' in dialog ? productsByCode.get(dialog.skuCode) : undefined;

  function select(skuCodes: string[]) {
    setSelection({ snapshotId: state.snapshotId, skuCodes });
  }

  function openDialog(next: AssignmentDialog) {
    setError('');
    setDialog(next);
  }

  function closeDialog() {
    if (savingRef.current) return;
    setDialog(null);
  }

  async function save(command: SupplierAssignmentCommand, success: string) {
    if (savingRef.current) return false;
    if (readOnly) {
      setError('Общий документ доступен только для чтения. Изменение связей запрещено.');
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      if (shared && catalogMode) {
        await shared.changeCatalog({ kind: 'assign', command }, success);
        return true;
      }
      const codes = 'skuCodes' in command ? command.skuCodes : [command.skuCode];
      const patch = (current: typeof state) => {
        if (
          (!current.catalog && !current.supplierAssignments) ||
          current.workspaceId !== state.workspaceId ||
          current.snapshotId !== state.snapshotId
        ) {
          throw new Error('The current catalog has changed');
        }
        if (
          command.kind === 'set-primary' &&
          (current.catalog?.assignments ?? current.supplierAssignments) !== assignments
        ) {
          const affected = new Set(codes);
          const currentPrimaries = new Map((current.catalog?.assignments ?? current.supplierAssignments ?? [])
            .filter((assignment) => affected.has(assignment.skuCode))
            .map((assignment) => [assignment.skuCode, assignment.primary]));
          if (codes.some((code) => (
            (assignmentsByCode.get(code)?.primary ?? null) !== (currentPrimaries.get(code) ?? null)
          ))) {
            throw new Error('The primary supplier has changed');
          }
        }
        return {
          ...(current.catalog
            ? { catalog: changeCatalogAssignment(current.catalog, command) }
            : { supplierAssignments: applySupplierAssignmentChange(current.supplierAssignments ?? [], command) }),
          toast: success,
        };
      };
      if (commit) await commit(patch);
      else set(patch(state));
      return true;
    } catch (error) {
      setError(shared && error instanceof Error ? error.message : 'Не удалось сохранить связи поставщиков. Повторите действие.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function editProduct(product?: CatalogProduct) {
    if (!shared || !catalogMode || readOnly) return;
    setProductEditor({
      ...(product && { product }),
      base: { catalog: state.catalog, catalogRevision: shared.catalogRevision },
    });
  }

  function showProducts(supplier: string, role: SupplierRole) {
    setFilters({ ...defaultProductFilters, supplier, role });
    setInactiveFilters({ ...defaultProductFilters, supplier, role });
    setView('products');
    productTab.current?.focus({ preventScroll: true });
  }

  return (
    <>
      {!catalogMode && <PurchasingDataAlert issues={derived.projection.dataIssues} />}
      <div className="workspace-tabs supplier-views" role="group" aria-label="Представления поставщиков">
        <button ref={productTab} aria-pressed={view === 'products'} onClick={() => setView('products')}>
          Товары · {catalogMode ? products?.length ?? 0 : state.minMax ? currentCodes.size : '—'}
        </button>
        {!catalogMode && <button aria-pressed={view === 'inactive'} onClick={() => setView('inactive')}>
          Неактивные · {state.minMax ? inactiveCount : '—'}
        </button>}
        <button aria-pressed={view === 'suppliers'} onClick={() => setView('suppliers')}>
          По поставщикам
        </button>
      </div>
      <div className="supplier-view-panels">
        {catalogMode && !readOnly && view !== 'suppliers' && (
          <Button className="secondary" onClick={() => editProduct()}>Добавить товар</Button>
        )}
        <SupplierProducts
          active={view !== 'suppliers'}
          mode={catalogMode ? 'catalog' : view === 'inactive' ? 'inactive' : 'current'}
          hasMinMax={state.minMax !== null}
          {...(shared && { catalogReadOnly: shared.catalogReadOnly })}
          products={products ?? []}
          currentCodes={currentCodes}
          suppliers={suppliers}
          assignmentsByCode={assignmentsByCode}
          demandCodes={demandCodes}
          filters={view === 'inactive' ? inactiveFilters : filters}
          onFiltersChange={view === 'inactive' ? setInactiveFilters : setFilters}
          selectedCodes={selectedCodes}
          onSelect={select}
          onOpenProduct={(skuCode) => openDialog({ skuCode })}
          {...(catalogMode && !readOnly && { onEditProduct: editProduct })}
          onOpenBulk={(visibleCodes) => openDialog({ skuCodes: selectedCodes, visibleCodes })}
        />
        {view === 'suppliers' && (
          <>
            {!catalogMode && <p className="muted">Количество связей — по всему справочнику, суммы закупки — по MIN/MAX выбранного сеанса. Неактивные товары доступны в отдельной вкладке.</p>}
            <SupplierRoster
              catalogMode={catalogMode}
              catalogAssignments={assignmentsByCode}
              productsByCode={productsByCode}
              orders={derived.projection.orders}
              suppliers={suppliers}
              onShowProducts={showProducts}
            />
          </>
        )}
      </div>
      {productEditor && shared && (
        <CatalogProductDialog
          product={productEditor.product}
          onSave={(product) => shared.changeCatalog(
            { kind: 'save-product', product, isNew: !productEditor.product },
            'Карточка товара сохранена.', productEditor.base,
          )}
          onClose={() => setProductEditor(null)}
        />
      )}
      {product && (
        <ProductSupplierDialog
          product={product}
          assignment={assignmentsByCode.get(product.code)}
          saving={saving}
          suppliers={suppliers}
          error={error}
          onDismissError={() => setError('')}
          onSave={save}
          onClose={closeDialog}
        />
      )}
      {dialog && 'skuCodes' in dialog && (
        <BulkSupplierDialog
          skuCodes={dialog.skuCodes}
          visibleCodes={dialog.visibleCodes}
          assignmentsByCode={assignmentsByCode}
          suppliers={suppliers}
          saving={saving}
          error={error}
          onSave={async (command, success) => {
            const saved = await save(command, success);
            if (saved) {
              if (command.kind === 'set-primary') {
                const changed = new Set(command.skuCodes);
                select(selectedCodes.filter((code) => !changed.has(code)));
              }
              closeDialog();
            }
            return saved;
          }}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
