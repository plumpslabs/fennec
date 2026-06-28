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
        const value = await session.page.evaluate((k) => localStorage.getItem(k), input.key);
        return responseBuilder.success({ value, size: value?.length ?? 0 }, sessionManager.buildMeta(session));
      } else {
        const allItems = await session.page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) items[key] = localStorage.getItem(key) ?? "";
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
        (k) => localStorage.getItem(k),
        input.key,
      );
      await session.page.evaluate(
        (k, v) => localStorage.setItem(k, v),
        input.key,
        input.value,
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
      await session.page.evaluate((k) => localStorage.removeItem(k), input.key);
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
        const n = localStorage.length;
        localStorage.clear();
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
        const value = await session.page.evaluate((k) => sessionStorage.getItem(k), input.key);
        return responseBuilder.success({ value }, sessionManager.buildMeta(session));
      } else {
        const allItems = await session.page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) items[key] = sessionStorage.getItem(key) ?? "";
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
        (k, v) => sessionStorage.setItem(k, v),
        input.key,
        input.value,
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
      const context = session.context;
      const cookies = await context.cookies();

      let filtered = cookies;
      if (input.name) {
        filtered = filtered.filter((c) => c.name === input.name);
      }
      if (input.domain) {
        filtered = filtered.filter((c) => c.domain.includes(input.domain));
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
      const result = await session.page.evaluate(
        ({ dbName, storeName }) => {
          return new Promise<{ databases: Array<{ name: string; version: number; stores: string[] }>; records?: unknown[] }>(
            (resolve, reject) => {
              if (!dbName) {
                const dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
                dbs.then((dbs) => {
                  resolve({
                    databases: dbs.map((db) => ({ name: db.name ?? "unknown", version: db.version ?? 0, stores: [] })),
                  });
                }).catch(reject);
                return;
              }

              const request = indexedDB.open(dbName);
              request.onsuccess = () => {
                const db = request.result;
                const storeNames = Array.from(db.objectStoreNames);

                const databases = [{
                  name: dbName,
                  version: db.version,
                  stores: storeNames,
                }];

                let records: unknown[] | undefined;

                if (storeName && storeNames.includes(storeName)) {
                  const transaction = db.transaction(storeName, "readonly");
                  const store = transaction.objectStore(storeName);
                  const getAll = store.getAll();
                  getAll.onsuccess = () => {
                    records = getAll.result;
                    db.close();
                    resolve({ databases, records });
                  };
                  getAll.onerror = () => {
                    db.close();
                    resolve({ databases, records: [] });
                  };
                } else {
                  db.close();
                  resolve({ databases });
                }
              };

              request.onerror = () => {
                reject(new Error(`Failed to open database: ${dbName}`));
              };
            },
          );
        },
        { dbName: input.dbName ?? null, storeName: input.storeName ?? null },
      );

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        suggestions: ["IndexedDB may not be available on all pages"],
      });
    }
  },
});
