// Loads the SQLite (sql.js) WebAssembly build from the app bundle, so importing works offline.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

let loading: Promise<SqlJsStatic> | undefined;
export function loadSql(): Promise<SqlJsStatic> {
  loading ??= initSqlJs({ locateFile: () => wasmUrl });
  return loading;
}
