export type StockStatus='NO_NORM'|'OK'|'YELLOW'|'ORANGE'|'LIGHT_RED'|'BELOW_MIN'|'INVALID_NORM';
export interface Sku{code:string;article:string|null;name:string;referencePrice:number|null;reportedTotalStock:number|null}
export interface BranchStock{skuCode:string;branch:string;stock:number;min:number|null;max:number|null}
export interface MinMaxDataset{skus:Sku[];branchStocks:BranchStock[];branches:string[]}
export interface SupplierHistory{supplier:string;skuCode:string;skuName:string|null;unit:string|null;purchaseQty:number;purchaseAmount:number;weightedUnitCost:number|null}
export interface SupplierOverride{skuCode:string;supplier:string;updatedAt:string}
export type SupplierResolutionStatus='AUTO_SINGLE'|'MANUAL_SELECTED'|'MANUAL_REQUIRED'|'STALE_OVERRIDE'|'UNRESOLVED';
export interface SupplierResolution{skuCode:string;selectedSupplier:string|null;status:SupplierResolutionStatus;candidates:SupplierHistory[];recommendedSupplier:string|null}
export type PriceSource='SUPPLIER_HISTORY'|'MIN_MAX_FALLBACK'|'MISSING';
export interface DemandLine{skuCode:string;article:string|null;name:string;branch:string;stock:number;min:number|null;max:number|null;status:StockStatus;deficitQty:number;deficitPct:number|null;networkDeficitQty:number;referencePrice:number|null}
export interface PricedDemandLine extends DemandLine{selectedSupplier:string|null;supplierResolutionStatus:SupplierResolutionStatus;unit:string|null;unitPrice:number|null;priceSource:PriceSource;demandAmount:number|null;networkDemandAmount:number;networkMissingPriceCount:number}
export interface OrderQtyEdit{skuCode:string;branch:string;qty:number}
export type ThresholdMode='SUPPLIER_TOTAL'|'BRANCH_SUPPLIER'; export interface OrderSettings{minimumOrderAmount:number;thresholdMode:ThresholdMode}
export interface OrderLine{skuCode:string;article:string|null;name:string;branch:string;supplier:string;calculatedQty:number;orderQty:number;unit:string|null;unitPrice:number|null;priceSource:PriceSource;amount:number|null;warnings:string[];stock:number;min:number|null;max:number|null}
export type OrderStatus='DRAFT'|'BLOCKED'|'READY'|'EXPORTED'; export interface Order{id:string;branch:string;supplier:string;lines:OrderLine[];totalQty:number;totalAmount:number|null;belowThreshold:boolean;status:OrderStatus;blockers:string[]}
export interface UnassignedDemand{demand:PricedDemandLine;supplierResolution:SupplierResolution;blocker:'NO_SUPPLIER'|'MULTIPLE_SUPPLIERS_REQUIRE_CHOICE'|'STALE_SUPPLIER_OVERRIDE'}
export interface OrderProjection{orders:Order[];unassigned:UnassignedDemand[]}
export type ValidationIssue={severity:'WARNING'|'ERROR';code:'MISSING_REQUIRED_COLUMN'|'NO_SKU_BLOCKS'|'NO_BRANCHES'|'DUPLICATE_SKU_BRANCH'|'INVALID_NORM'|'TOTAL_STOCK_MISMATCH'|'MISSING_REFERENCE_PRICE'|'NO_SUPPLIER_HISTORY'|'MULTIPLE_SUPPLIERS'|'MISSING_ORDER_PRICE'|'STALE_SUPPLIER_OVERRIDE'|'MIXED_UNITS';message:string;skuCode?:string;branch?:string;row?:number}
export interface ParseResult<T>{data:T|null;issues:ValidationIssue[];fatal:boolean}
export interface SupplierDataset{history:SupplierHistory[];suppliers:string[]}
