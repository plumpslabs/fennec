import { z } from "zod";
import { createTool } from "../_registry.js";

export const storageGetLocal = createTool({
  name: "storage_get_local",
  description: "`<use_case>Storage management</use_case> Get localStorage value by key or all items (if no key). value (str) or allItems (obj), size.`",
  inputSchema: z.object({
    key: z.string().optional().describe("localStorage key to retrieve"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.key) {
        const value = await session.page.evaluate((k: string) => localStorage.getItem(k), input.key);
        return responseBuilder.success({ value, size: value?.length ?? 0 }, sessionManager.buildMeta(session));
      } else {
        const allItems = await session.page.evaluate(() => {
          const ls = window.localStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key) items[key] = ls.getItem(key) ?? "";
          }
          return items;
        });
        return responseBuilder.success({ allItems, size: Object.keys(allItems).length }, sessionManager.buildMeta(session));
      }
    } catch (error) {
      return responseBuilder.error(error, {
        code: "STORAGE_ACCESS_DENIED",
        suggestions: ["localStorage may be restricted in private browsing or cross-origin contexts"],
      });
    }
  },
});

export const storageSetLocal = createTool({
  name: "storage_set_local",
  description: "`<use_case>Storage management</use_case> Set a localStorage value. previousValue.`",
  inputSchema: z.object({
    key: z.string().describe("localStorage key"),
    value: z.string().describe("Value to store"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const previousValue = await session.page.evaluate(
        (k: string) => localStorage.getItem(k),
        input.key as string,
      );
      await session.page.evaluate(
        (args: { k: string; v: string }) => localStorage.setItem(args.k, args.v),
        { k: input.key as string, v: input.value as string },
      );
      return responseBuilder.success({ previousValue }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: "STORAGE_ACCESS_DENIED" });
    }
  },
});

export const storageRemoveLocal = createTool({
  name: "storage_remove_local",
  description: "`<use_case>Storage management</use_case> Remove a localStorage key. success.`",
  inputSchema: z.object({
    key: z.string().describe("localStorage key to remove"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.page.evaluate((k: string) => localStorage.removeItem(k), input.key);
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: "STORAGE_ACCESS_DENIED" });
    }
  },
});

export const storageClearLocal = createTool({
  name: "storage_clear_local",
  description: "`<use_case>Storage management</use_case> Clear all localStorage data. clearedCount (int).`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const count = await session.page.evaluate(() => {
        const storage = window.localStorage;
        const n = storage.length;
        storage.clear();
        return n;
      });
      return responseBuilder.success({ clearedCount: count }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: "STORAGE_ACCESS_DENIED" });
    }
  },
});

export const storageGetSession = createTool({
  name: "storage_get_session",
  description: "`<use_case>Storage management</use_case> Get sessionStorage value by key or all items (if no key). value (str) or allItems (obj).`",
  inputSchema: z.object({
    key: z.string().optional().describe("sessionStorage key to retrieve"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.key) {
        const value = await session.page.evaluate((k: string) => sessionStorage.getItem(k), input.key);
        return responseBuilder.success({ value }, sessionManager.buildMeta(session));
      } else {
        const allItems = await session.page.evaluate(() => {
          const ss = window.sessionStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ss.length; i++) {
            const key = ss.key(i);
            if (key) items[key] = ss.getItem(key) ?? "";
          }
          return items;
        });
        return responseBuilder.success({ allItems }, sessionManager.buildMeta(session));
      }
    } catch (error) {
      return responseBuilder.error(error, { code: "STORAGE_ACCESS_DENIED" });
    }
  },
});

export const storageSetSession = createTool({
  name: "storage_set_session",
  description: "`<use_case>Storage management</use_case> Set a sessionStorage value. success.`",
  inputSchema: z.object({
    key: z.string().describe("sessionStorage key"),
    value: z.string().describe("Value to store"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.page.evaluate(
        (args: { k: string; v: string }) => sessionStorage.setItem(args.k, args.v),
        { k: input.key as string, v: input.value as string },
      );
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: "STORAGE_ACCESS_DENIED" });
    }
  },
});

export const storageGetCookies = createTool({
  name: "storage_get_cookies",
  description: "`<use_case>Storage management</use_case> Get browser cookies, filterable by name or domain. cookies[], count.`",
  inputSchema: z.object({
    name: z.string().optional().describe("Filter by cookie name"),
    domain: z.string().optional().describe("Filter by cookie domain"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const ctx = session.context;
      const cookies = await ctx.cookies();

      let filtered = cookies;
      if (input.name) {
        const name = input.name;
        filtered = filtered.filter((c) => c.name === name);
      }
      if (input.domain) {
        const domain = input.domain;
        filtered = filtered.filter((c) => c.domain.includes(domain));
      }

      return responseBuilder.success({
        cookies: filtered,
        count: filtered.length,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageSetCookie = createTool({
  name: "storage_set_cookie",
  description: "`<use_case>Storage management</use_case> Set a browser cookie with name, value, domain, path, httpOnly, secure, sameSite. success.`",
  inputSchema: z.object({
    name: z.string().describe("Cookie name"),
    value: z.string().describe("Cookie value"),
    domain: z.string().optional().describe("Cookie domain"),
    path: z.string().optional().describe("Cookie path"),
    httpOnly: z.boolean().optional().describe("HTTP-only flag"),
    secure: z.boolean().optional().describe("Secure flag"),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional().describe("SameSite policy"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.context.addCookies([{
        name: input.name,
        value: input.value,
        domain: input.domain,
        path: input.path ?? "/",
        httpOnly: input.httpOnly,
        secure: input.secure,
        sameSite: input.sameSite,
        url: input.domain ? undefined : session.page.url(),
      }]);
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageDeleteCookie = createTool({
  name: "storage_delete_cookie",
  description: "`<use_case>Storage management</use_case> Delete a browser cookie by name. success.`",
  inputSchema: z.object({
    name: z.string().describe("Cookie name to delete"),
    domain: z.string().optional().describe("Cookie domain"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const url = session.page.url();
      await session.context.clearCookies();
      // Re-add all cookies except the one to delete
      const cookies = await session.context.cookies();
      const filtered = cookies.filter((c) => c.name !== input.name);
      if (filtered.length > 0) {
        await session.context.addCookies(filtered.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
        })));
      }
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageGetIndexedDB = createTool({
  name: "storage_get_indexeddb",
  description: "`<use_case>Storage management</use_case> Get IndexedDB database names and optionally records from a specific object store. databases[], records (optional).`",
  inputSchema: z.object({
    dbName: z.string().optional().describe("Database name"),
    storeName: z.string().optional().describe("Object store name (requires dbName)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const dbName = input.dbName ?? null;
      const storeName = input.storeName ?? null;
      const result = await session.page.evaluate(
        ({ dbName: db, storeName: store }: { dbName: string | null; storeName: string | null }) => {
          return new Promise<{ databases: Array<{ name: string; version: number; stores: string[] }>; records?: unknown[] }>(
            (resolve, reject) => {
              if (!db) {
                const dbsList = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
                dbsList.then((dbs) => {
                  resolve({
                    databases: dbs.map((dbEntry) => ({ name: dbEntry.name ?? "unknown", version: dbEntry.version ?? 0, stores: [] })),
                  });
                }).catch(reject);
                return;
              }

              const request = indexedDB.open(db);
              request.onsuccess = () => {
                const dbResult = request.result;
                const storeNames = Array.from(dbResult.objectStoreNames);

                const databases = [{
                  name: db,
                  version: dbResult.version,
                  stores: storeNames,
                }];

                let records: unknown[] | undefined;

                if (store && storeNames.includes(store)) {
                  const transaction = dbResult.transaction(store, "readonly");
                  const objStore = transaction.objectStore(store);
                  const getAll = objStore.getAll();
                  getAll.onsuccess = () => {
                    records = getAll.result;
                    dbResult.close();
                    resolve({ databases, records });
                  };
                  getAll.onerror = () => {
                    dbResult.close();
                    resolve({ databases, records: [] });
                  };
                } else {
                  dbResult.close();
                  resolve({ databases });
                }
              };

              request.onerror = () => {
                reject(new Error(`Failed to open database: ${db}`));
              };
            },
          );
        },
        { dbName, storeName },
      );

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        suggestions: ["IndexedDB may not be available on all pages"],
      });
    }
  },
});

// ─── Storage Export / Import ─────────────────────────────────────

export const storageExportState = createTool({
  name: "storage_export_state",
  description: "`<use_case>Storage management</use_case> Export all browser state (cookies, localStorage, sessionStorage) to a JSON object or file. cookies, localStorage, sessionStorage, savedAt.`",
  inputSchema: z.object({
    filePath: z.string().optional().describe("Optional file path to save the state to"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cookies = await session.context.cookies();
      const origin = session.page.url();

      const localStorageData = await session.page.evaluate(() => {
        const ls = window.localStorage;
        const items: Record<string, string> = {};
        for (let i = 0; i < ls.length; i++) {
          const key = ls.key(i);
          if (key) items[key] = ls.getItem(key) ?? "";
        }
        return items;
      }).catch(() => ({} as Record<string, string>));

      const sessionStorageData = await session.page.evaluate(() => {
        const ss = window.sessionStorage;
        const items: Record<string, string> = {};
        for (let i = 0; i < ss.length; i++) {
          const key = ss.key(i);
          if (key) items[key] = ss.getItem(key) ?? "";
        }
        return items;
      }).catch(() => ({} as Record<string, string>));

      const state = {
        cookies: cookies.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
        })),
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        origin,
        savedAt: new Date().toISOString(),
      };

      if (input.filePath) {
        const { writeFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const exportDir = config.security.exportPath;
        const fullPath = resolve(exportDir, input.filePath);
        writeFileSync(fullPath, JSON.stringify(state, null, 2), "utf-8");
        return responseBuilder.success({ ...state, savedTo: fullPath }, sessionManager.buildMeta(session));
      }

      return responseBuilder.success(state, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "STORAGE_ACCESS_DENIED",
        suggestions: ["Storage export may be restricted in cross-origin contexts"],
      });
    }
  },
});

export const storageImportState = createTool({
  name: "storage_import_state",
  description: "`<use_case>Storage management</use_case> Import previously exported browser state from a state object or file. Restores cookies, localStorage, and sessionStorage. cookiesRestored, itemsRestored.`",
  inputSchema: z.object({
    filePath: z.string().optional().describe("File path to load state from"),
    stateObject: z.string().optional().describe("JSON string of state object (alternative to filePath)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      let state: any;

      if (input.stateObject) {
        state = JSON.parse(input.stateObject);
      } else if (input.filePath) {
        const { readFileSync, existsSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const exportDir = config.security.exportPath;
        const fullPath = resolve(exportDir, input.filePath);
        if (!existsSync(fullPath)) {
          return responseBuilder.error(
            new Error(`State file not found: ${fullPath}`),
            { code: "STATE_FILE_NOT_FOUND" },
          );
        }
        state = JSON.parse(readFileSync(fullPath, "utf-8"));
      } else {
        return responseBuilder.error(
          new Error("Either filePath or stateObject is required"),
          { code: "INVALID_INPUT" },
        );
      }

      // Restore cookies
      if (state.cookies && state.cookies.length > 0) {
        await session.context.addCookies(state.cookies.map((c: Record<string, any>) => ({
          name: c.name, value: c.value,
          domain: c.domain, path: c.path ?? "/",
          httpOnly: c.httpOnly, secure: c.secure,
          sameSite: c.sameSite,
        })));
      }

      // Navigate to origin if different
      if (state.origin && session.page.url() !== state.origin) {
        await session.page.goto(state.origin).catch(() => {});
      }

      // Restore localStorage
      let itemsRestored = 0;
      if (state.localStorage) {
        for (const [key, value] of Object.entries(state.localStorage)) {
          await session.page.evaluate(
            (args: { k: string; v: string }) => localStorage.setItem(args.k, args.v),
            { k: key as string, v: value as string },
          ).catch(() => {});
          itemsRestored++;
        }
      }

      // Restore sessionStorage
      if (state.sessionStorage) {
        for (const [key, value] of Object.entries(state.sessionStorage)) {
          await session.page.evaluate(
            (args: { k: string; v: string }) => sessionStorage.setItem(args.k, args.v),
            { k: key as string, v: value as string },
          ).catch(() => {});
          itemsRestored++;
        }
      }

      return responseBuilder.success({
        cookiesRestored: state.cookies?.length ?? 0,
        itemsRestored,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "STORAGE_ACCESS_DENIED",
        suggestions: ["Verify the file path or JSON string is valid"],
      });
    }
  },
});
