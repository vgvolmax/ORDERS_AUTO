import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { PurchasingDataAlert } from '../../components/PurchasingDataAlert';
import { Button, EmptyState } from '../../components/ui';
import {
  applySupplierAssignmentChange,
  type SupplierAssignment,
  type SupplierAssignmentCommand,
} from '../../domain/supplierAssignments';
import { SUPPLIER_POOL } from '../../domain/supplierPool';
import { changeCatalogAssignment } from '../../domain/supplierCatalog';
import { BulkSupplierDialog, ProductSupplierDialog } from './SupplierAssignmentDialogs';
import {
  SupplierProducts,
  defaultProductFilters,
  type ProductFilters,
  type SupplierRole,
} from './SupplierProducts';
import { SupplierRoster } from './SupplierRoster';
import './SuppliersPage.css';

type AssignmentDialog = { skuCode: string } | { skuCodes: string[] };
interface SupplierSelection {
  snapshotId: string;
  skuCodes: string[];
}

export function SuppliersPage() {
  const { state } = useStore();
  return (
    <main className="suppliers-page">
      <header>
        <p className="eyebrow">Закупка</p>
        <h1>Поставщики</h1>
        <p>Постоянный справочник товаров и поставщиков. Назначения сохраняются независимо от рабочих сеансов.</p>
      </header>
      {!state.catalog && state.supplierAssignments === undefined ? (
        <EmptyState>Загрузите отчёты, чтобы открыть каталог и связи поставщиков.</EmptyState>
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
  const { state, set, commit } = useStore();
  const derived = useDerivedState(state);
  const [view, setView] = useState<'products' | 'suppliers'>('products');
  const [filters, setFilters] = usePreference<ProductFilters>(
    'suppliers:productFilters',
    defaultProductFilters,
  );
  const [selection, setSelection] = usePreference<SupplierSelection | null>(
    'suppliers:selectedCodes',
    null,
  );
  const [dialog, setDialog] = useState<AssignmentDialog | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const productTab = useRef<HTMLButtonElement>(null);
  const products = state.catalog?.products ?? state.minMax?.skus;
  const currentCodes = useMemo(() => new Set(state.minMax?.skus.map((sku) => sku.code)), [state.minMax]);
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
      ? selection.skuCodes.filter((skuCode) => productsByCode.has(skuCode))
      : [],
    [productsByCode, selection, state.snapshotId],
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
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
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
    } catch {
      setError('Не удалось сохранить связи поставщиков. Повторите действие.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function showProducts(supplier: string, role: SupplierRole) {
    setFilters({ ...defaultProductFilters, supplier, role });
    setView('products');
    productTab.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <PurchasingDataAlert issues={derived.projection.dataIssues} />
      {state.catalog && <p className="muted">Связи меняются в справочнике и для затронутых товаров текущего сеанса. Сохранённые сеансы остаются прежними. Потребность и суммы относятся к текущему MIN/MAX.</p>}
      <div className="workspace-tabs supplier-views" role="group" aria-label="Представления поставщиков">
        <button ref={productTab} aria-pressed={view === 'products'} onClick={() => setView('products')}>
          Товары
        </button>
        <button aria-pressed={view === 'suppliers'} onClick={() => setView('suppliers')}>
          По поставщикам
        </button>
      </div>
      <div className="supplier-view-panels">
        <SupplierProducts
          active={view === 'products'}
          products={products ?? []}
          currentCodes={currentCodes}
          assignmentsByCode={assignmentsByCode}
          demandCodes={demandCodes}
          filters={filters}
          onFiltersChange={setFilters}
          selectedCodes={selectedCodes}
          onSelect={select}
          onOpenProduct={(skuCode) => openDialog({ skuCode })}
          onOpenBulk={() => openDialog({ skuCodes: selectedCodes })}
        />
        {view === 'suppliers' && (
          <SupplierRoster
            catalogAssignments={assignmentsByCode}
            productsByCode={productsByCode}
            orders={derived.projection.orders}
            suppliers={SUPPLIER_POOL}
            onShowProducts={showProducts}
          />
        )}
      </div>
      {product && (
        <ProductSupplierDialog
          product={product}
          assignment={assignmentsByCode.get(product.code)}
          saving={saving}
          error={error}
          onDismissError={() => setError('')}
          onSave={save}
          onClose={closeDialog}
        />
      )}
      {dialog && 'skuCodes' in dialog && (
        <BulkSupplierDialog
          skuCodes={dialog.skuCodes}
          assignmentsByCode={assignmentsByCode}
          saving={saving}
          error={error}
          onSave={async (command, success) => {
            const saved = await save(command, success);
            if (saved) {
              select([]);
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
