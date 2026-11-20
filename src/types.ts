// 领域类型定义：所有时间统一使用 UTC ISO8601 字符串，内部计算单位统一为
// 水量 m³、流量 m³/s、水位 m、面积 m²、雨量/蒸发 mm。

export type ID = string;
export type ISOTime = string;

/** 质量标志：confirmed 已确认；estimated 估算可用；suspect 可疑；missing 显式缺失；rejected 作废 */
export type QualityFlag = 'confirmed' | 'estimated' | 'suspect' | 'missing' | 'rejected';

export type ReadingKind =
  | 'rainfall' // 雨量（区间累计，mm）
  | 'water_level' // 库水位（m）
  | 'inflow' // 入库流量（m³/s）
  | 'outflow' // 出库流量（m³/s）
  | 'gate_opening' // 闸门开度
  | 'gate_order' // 闸门指令
  | 'evaporation' // 蒸发（区间累计，mm）
  | 'diversion_in' // 跨库调入（m³/s）
  | 'diversion_out'; // 跨库调出（m³/s）

export interface RawReading {
  id: ID;
  reservoirId?: ID;
  stationId?: ID;
  zoneId?: ID;
  kind: ReadingKind;
  /** 采样时间；区间累计类为区间结束时刻 */
  sampledAt: ISOTime;
  /** 接收时间：迟到判定与资料截止点过滤依据 */
  receivedAt: ISOTime;
  /** 区间累计类（雨量/蒸发）的区间起点 */
  intervalStart?: ISOTime;
  /** 显式缺失记为 null，绝不以 0 补齐 */
  value: number | null;
  unit: string;
  quality: QualityFlag;
  sourceFile: string;
  /** 修订关系：本读数修订哪一条原始读数 */
  revisionOf?: ID;
  /** 被哪一条修订替代（物化在被替代记录上） */
  supersededById?: ID;
  /** 仪器额定不确定度（同 unit），缺失时用于未知范围估算 */
  uncertainty?: number;
  note?: string;
  createdAt: ISOTime;
}

export interface RainZone {
  id: ID;
  name: string;
}

export interface RainStation {
  id: ID;
  name: ID;
  zoneId: ID;
  lon: number;
  lat: number;
}

export interface Reservoir {
  id: ID;
  name: string;
  lon: number;
  lat: number;
  /** 面雨量分区权重，权重之和应为 1 */
  rainWeights: { zoneId: ID; weight: number }[];
}

export type CurveKind = 'storage' | 'area';
export type ApprovalStatus = 'draft' | 'approved' | 'retired';

export interface CurvePoint {
  x: number; // 水位 m
  y: number; // storage: 蓄水量（按 storageUnit）；area: 库面面积（按 areaUnit）
}

export interface CurveVersion {
  id: ID;
  reservoirId: ID;
  kind: CurveKind;
  version: string;
  validFrom: ISOTime;
  validTo?: ISOTime; // 空表示至今
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  points: CurvePoint[];
  /** storage 曲线点单位：m3 或 万m3；area 曲线点单位：m2 或 km2 */
  pointUnit: 'm3' | 'wan_m3' | 'm2' | 'km2';
  note?: string;
}

export interface DispatchRule {
  id: ID;
  reservoirId: ID;
  version: string;
  validFrom: ISOTime;
  validTo?: ISOTime;
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  /** 汛限库容 m³ */
  floodLimitStorage: number;
  /** 规则目标库容 m³（泄洪空间回算目标） */
  targetStorage: number;
  /** 下游允许泄流范围 m³/s */
  downstreamMinRelease: number;
  downstreamMaxRelease: number;
  note?: string;
}

export type RunStatus = 'running' | 'completed' | 'completed_with_warnings' | 'failed';
export type RunDesign = 'materialized' | 'on_demand';

export interface RunTolerance {
  /** 绝对容差 m³ */
  absM3: number;
  /** 相对容差（占蓄变与各项绝对值均值的比例） */
  relFraction: number;
}

export interface BalanceRun {
  id: ID;
  name: string;
  /** 资料截止点：仅纳入 receivedAt <= cutoff 的读数 */
  cutoffAt: ISOTime;
  gridStart: ISOTime;
  gridEnd: ISOTime;
  /** 时间网格步长（秒） */
  gridStepSeconds: number;
  tolerance: RunTolerance;
  /** 近期来水压力窗口（秒） */
  pressureWindowSeconds: number;
  /** 下一决策时点距离（秒） */
  decisionHorizonSeconds: number;
  reservoirIds: ID[];
  status: RunStatus;
  design: RunDesign;
  createdAt: ISOTime;
  finishedAt?: ISOTime;
  warnings: string[];
  stats?: { factCount: number; pendingCount: number; unclosedCount: number };
}

/** 运行输入快照：运行时固定的一组来源、曲线版本、规则，保证可复算 */
export interface RunSnapshot {
  runId: ID;
  readings: RawReading[];
  curves: CurveVersion[];
  rules: DispatchRule[];
  reservoirs: Reservoir[];
  zones: RainZone[];
  frozenAt: ISOTime;
}

export interface BalanceTerm {
  key: 'inflow' | 'outflow' | 'rainfall' | 'evaporation' | 'transferIn' | 'transferOut';
  label: string;
  /** 折算出的区间水量 m³；覆盖不足为 null */
  valueM3: number | null;
  covered: boolean;
  sourceReadingIds: ID[];
  /** 该项未知量的可能范围 m³（仅未覆盖/可疑时非零） */
  unknownRangeM3: [number, number];
  detail?: string;
}

export interface BalanceFact {
  id: ID;
  runId: ID;
  reservoirId: ID;
  t1: ISOTime;
  t2: ISOTime;
  durationSeconds: number;
  s1: number | null;
  s2: number | null;
  storageCurveIdAtT1?: ID;
  storageCurveIdAtT2?: ID;
  areaCurveId?: ID;
  curveSwitched: boolean;
  terms: BalanceTerm[];
  /** ΔS = S2-S1 m³ */
  deltaS: number | null;
  /** 可确认平衡项合计（方程括号内部分），m³ */
  confirmedNet: number | null;
  /** 残差 R = ΔS - 平衡项合计；任一关键项未覆盖则为 null */
  residual: number | null;
  closed: boolean;
  toleranceM3: number;
  unclosedReasons: string[];
  /** 整个区间未知量的可能范围 m³ */
  unknownRangeM3: [number, number];
}

export type IndicatorStatus = 'ok' | 'warn' | 'pending';

export interface ReservoirIndicator {
  id: ID;
  runId: ID;
  reservoirId: ID;
  asOf: ISOTime;
  currentStorage: number | null;
  floodLimitStorage: number | null;
  ruleId?: ID;
  /** 防洪余量 = 汛限库容 - 已确认蓄水量 m³ */
  floodMargin: number | null;
  marginStatus: IndicatorStatus;
  windowSeconds: number;
  /** 窗口内可确认净入库量 m³ */
  netInflowConfirmed: number | null;
  /** 净入库未知范围 m³ */
  netInflowUnknownRange: [number, number] | null;
  /** 来水压力比 = 可确认净入库 / 防洪余量 */
  pressureRatio: number | null;
  /** 计入未知范围后的压力比区间 */
  pressureRatioRange: [number | null, number | null];
  /** 回到目标库容所需出库流量范围 m³/s */
  releaseNeededRange: [number | null, number | null] | null;
  downstreamAllowableRange: [number, number] | null;
  /** 所需出库与下游允许范围的差额 m³/s（正值表示允许泄流不足） */
  releaseGapRange: [number | null, number | null] | null;
  pending: boolean;
  pendingReasons: string[];
  factIds: ID[];
}

export interface AnnotationField {
  field: string;
  author: string;
  value: string;
  updatedAt: ISOTime;
}

export interface Annotation {
  id: ID;
  subjectType: 'indicator' | 'fact' | 'reading' | 'rule' | 'curve';
  subjectId: ID;
  /** 字段级批注：两个页面并发修改不同字段时各自保留，不做整单覆盖 */
  fields: Record<string, AnnotationField>;
  revision: number;
  updatedAt: ISOTime;
}

export interface SourceFileRecord {
  id: ID;
  fileName: string;
  kind: ReadingKind | 'mixed';
  importedAt: ISOTime;
  readingCount: number;
  byteSize: number;
  note?: string;
}
