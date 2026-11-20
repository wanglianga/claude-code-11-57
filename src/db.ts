// IndexedDB 存储层：原始读数、曲线/规则目录、运行、平衡事实、指标、字段级批注
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Annotation,
  BalanceFact,
  CurveVersion,
  DispatchRule,
  RawReading,
  Reservoir,
  ReservoirIndicator,
  BalanceRun,
  RunSnapshot,
  SourceFileRecord,
  RainZone,
  RainStation,
} from './types';

export const DB_NAME = 'flood-dispatch-db';
export const DB_VERSION = 1;

interface FloodDB extends DBSchema {
  raw_readings: {
    key: string;
    value: RawReading;
    indexes: {
      by_kind: string;
      by_reservoir: string;
      by_sampled: string;
    };
  };
  reservoirs: { key: string; value: Reservoir };
  rain_zones: { key: string; value: RainZone };
  rain_stations: { key: string; value: RainStation };
  curves: { key: string; value: CurveVersion; indexes: { by_reservoir_kind: [string, string] } };
  rules: { key: string; value: DispatchRule; indexes: { by_reservoir: string } };
  runs: { key: string; value: BalanceRun };
  snapshots: { key: string; value: RunSnapshot };
  facts: {
    key: string;
    value: BalanceFact;
    indexes: { by_run: string; by_run_reservoir: [string, string] };
  };
  indicators: { key: string; value: ReservoirIndicator; indexes: { by_run: string } };
  annotations: {
    key: string;
    value: Annotation;
    indexes: { by_subject: [string, string] };
  };
  source_files: { key: string; value: SourceFileRecord };
}

let dbPromise: Promise<IDBPDatabase<FloodDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FloodDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FloodDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const readings = db.createObjectStore('raw_readings', { keyPath: 'id' });
        readings.createIndex('by_kind', 'kind');
        readings.createIndex('by_reservoir', 'reservoirId');
        readings.createIndex('by_sampled', 'sampledAt');
        db.createObjectStore('reservoirs', { keyPath: 'id' });
        db.createObjectStore('rain_zones', { keyPath: 'id' });
        db.createObjectStore('rain_stations', { keyPath: 'id' });
        const curves = db.createObjectStore('curves', { keyPath: 'id' });
        curves.createIndex('by_reservoir_kind', ['reservoirId', 'kind']);
        const rules = db.createObjectStore('rules', { keyPath: 'id' });
        rules.createIndex('by_reservoir', 'reservoirId');
        db.createObjectStore('runs', { keyPath: 'id' });
        db.createObjectStore('snapshots', { keyPath: 'runId' });
        const facts = db.createObjectStore('facts', { keyPath: 'id' });
        facts.createIndex('by_run', 'runId');
        facts.createIndex('by_run_reservoir', ['runId', 'reservoirId']);
        const indicators = db.createObjectStore('indicators', { keyPath: 'id' });
        indicators.createIndex('by_run', 'runId');
        const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('by_subject', ['subjectType', 'subjectId']);
        db.createObjectStore('source_files', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** 测试专用：重置库连接 */
export function resetDBConnection(): void {
  dbPromise = null;
}

// ---------- 原始读数与修订关系 ----------

/**
 * 批量导入读数并建立修订关系：
 * 重叠雨量上传若带 revisionOf，则标记旧记录 supersededById（替代而非累加）；
 * 修订链在同一事务内闭环。
 */
export async function importReadings(
  readings: RawReading[],
  fileRecord: SourceFileRecord,
): Promise<{ imported: number; revisions: number }> {
  const db = await getDB();
  let revisions = 0;
  const tx = db.transaction(['raw_readings', 'source_files'], 'readwrite');
  for (const r of readings) {
    await tx.objectStore('raw_readings').put(r);
    if (r.revisionOf) {
      const old = await tx.objectStore('raw_readings').get(r.revisionOf);
      if (old) {
        await tx.objectStore('raw_readings').put({ ...old, supersededById: r.id });
        revisions += 1;
      }
    }
  }
  await tx.objectStore('source_files').put(fileRecord);
  await tx.done;
  return { imported: readings.length, revisions };
}

export async function getAllReadings(): Promise<RawReading[]> {
  const db = await getDB();
  return db.getAll('raw_readings');
}

export async function getReadingsForCutoff(cutoffAt: string): Promise<RawReading[]> {
  const all = await getAllReadings();
  return all.filter((r) => new Date(r.receivedAt).getTime() <= new Date(cutoffAt).getTime());
}

// ---------- 主数据 ----------

export async function putReservoir(r: Reservoir): Promise<void> {
  const db = await getDB();
  await db.put('reservoirs', r);
}
export async function getAllReservoirs(): Promise<Reservoir[]> {
  return (await getDB()).getAll('reservoirs');
}
export async function putRainZone(z: RainZone): Promise<void> {
  await (await getDB()).put('rain_zones', z);
}
export async function getAllRainZones(): Promise<RainZone[]> {
  return (await getDB()).getAll('rain_zones');
}
export async function putRainStation(s: RainStation): Promise<void> {
  await (await getDB()).put('rain_stations', s);
}
export async function getAllRainStations(): Promise<RainStation[]> {
  return (await getDB()).getAll('rain_stations');
}

// ---------- 曲线与规则目录 ----------

export async function putCurve(c: CurveVersion): Promise<void> {
  await (await getDB()).put('curves', c);
}
export async function getAllCurves(): Promise<CurveVersion[]> {
  return (await getDB()).getAll('curves');
}
export async function putRule(r: DispatchRule): Promise<void> {
  await (await getDB()).put('rules', r);
}
export async function getAllRules(): Promise<DispatchRule[]> {
  return (await getDB()).getAll('rules');
}

// ---------- 运行 / 快照 / 事实 / 指标 ----------

export async function saveRun(run: BalanceRun): Promise<void> {
  await (await getDB()).put('runs', run);
}
export async function getAllRuns(): Promise<BalanceRun[]> {
  return (await getDB()).getAll('runs');
}
export async function getRun(id: string): Promise<BalanceRun | undefined> {
  return (await getDB()).get('runs', id);
}
export async function saveSnapshot(s: RunSnapshot): Promise<void> {
  await (await getDB()).put('snapshots', s);
}
export async function getSnapshot(runId: string): Promise<RunSnapshot | undefined> {
  return (await getDB()).get('snapshots', runId);
}

export async function replaceFacts(runId: string, facts: BalanceFact[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('facts', 'readwrite');
  const existing = await tx.store.index('by_run').getAllKeys(runId);
  for (const key of existing) await tx.store.delete(key);
  for (const f of facts) await tx.store.put(f);
  await tx.done;
}

export async function getFactsByRun(runId: string): Promise<BalanceFact[]> {
  const db = await getDB();
  return db.getAllFromIndex('facts', 'by_run', runId);
}

export async function getFact(id: string): Promise<BalanceFact | undefined> {
  return (await getDB()).get('facts', id);
}

export async function replaceIndicators(runId: string, indicators: ReservoirIndicator[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('indicators', 'readwrite');
  const existing = await tx.store.index('by_run').getAllKeys(runId);
  for (const key of existing) await tx.store.delete(key);
  for (const i of indicators) await tx.store.put(i);
  await tx.done;
}

export async function getIndicatorsByRun(runId: string): Promise<ReservoirIndicator[]> {
  return (await getDB()).getAllFromIndex('indicators', 'by_run', runId);
}

export async function getIndicator(id: string): Promise<ReservoirIndicator | undefined> {
  return (await getDB()).get('indicators', id);
}

// ---------- 字段级批注与并发 ----------

export interface FieldMergeConflict {
  field: string;
  existing: Annotation['fields'][string];
  incoming: Annotation['fields'][string];
}

/**
 * 字段级合并：两个页面并发修改处置理由时，按字段分别保留；
 * 同一字段被双方改动时以 updatedAt 较新者胜，并在 conflicts 中留痕，
 * 不允许“最后保存者整单覆盖”。
 */
export function mergeAnnotationFields(
  existing: Annotation | undefined,
  subjectType: Annotation['subjectType'],
  subjectId: string,
  incoming: Annotation['fields'],
  atIso: string,
): { annotation: Annotation; conflicts: FieldMergeConflict[] } {
  const fields: Annotation['fields'] = existing ? { ...existing.fields } : {};
  const conflicts: FieldMergeConflict[] = [];
  for (const [field, inVal] of Object.entries(incoming)) {
    const cur = fields[field];
    if (!cur) {
      fields[field] = inVal;
    } else if (cur.author === inVal.author && cur.value === inVal.value) {
      // 相同内容幂等
    } else {
      // 同字段并发修改：较新时间胜，差异留痕
      conflicts.push({ field, existing: cur, incoming: inVal });
      if (new Date(inVal.updatedAt).getTime() >= new Date(cur.updatedAt).getTime()) {
        fields[field] = inVal;
      }
    }
  }
  const annotation: Annotation = {
    id: existing?.id ?? `ann-${subjectType}-${subjectId}`,
    subjectType,
    subjectId,
    fields,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: atIso,
  };
  return { annotation, conflicts };
}

const syncChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flood-annotation-sync') : null;

export function onAnnotationRemoteChange(cb: () => void): () => void {
  if (!syncChannel) return () => undefined;
  const handler = () => cb();
  syncChannel.addEventListener('message', handler);
  return () => syncChannel.removeEventListener('message', handler);
}

export async function saveAnnotationFields(
  subjectType: Annotation['subjectType'],
  subjectId: string,
  incoming: Annotation['fields'],
  atIso: string,
): Promise<{ annotation: Annotation; conflicts: FieldMergeConflict[] }> {
  const db = await getDB();
  const subjectKey = [subjectType, subjectId] as [string, string];
  const tx = db.transaction('annotations', 'readwrite');
  const existingList = await tx.store.index('by_subject').getAll(subjectKey);
  const existing = existingList[0];
  const { annotation, conflicts } = mergeAnnotationFields(existing, subjectType, subjectId, incoming, atIso);
  await tx.store.put(annotation);
  await tx.done;
  syncChannel?.postMessage({ subjectKey: subjectKey.join('|'), at: atIso });
  return { annotation, conflicts };
}

export async function getAnnotation(
  subjectType: Annotation['subjectType'],
  subjectId: string,
): Promise<Annotation | undefined> {
  const db = await getDB();
  return (await db.getAllFromIndex('annotations', 'by_subject', [subjectType, subjectId]))[0];
}

export async function getAllAnnotations(): Promise<Annotation[]> {
  return (await getDB()).getAll('annotations');
}

export async function getSourceFiles(): Promise<SourceFileRecord[]> {
  return (await getDB()).getAll('source_files');
}

export async function putSourceFile(f: SourceFileRecord): Promise<void> {
  await (await getDB()).put('source_files', f);
}

/** 清空全部业务数据（演示环境重置） */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const stores = [
    'raw_readings', 'reservoirs', 'rain_zones', 'rain_stations', 'curves', 'rules',
    'runs', 'snapshots', 'facts', 'indicators', 'annotations', 'source_files',
  ] as const;
  const tx = db.transaction([...stores], 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
