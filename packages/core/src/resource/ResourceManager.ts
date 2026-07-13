import { getLogger } from '../utils/logger.js';

export type ResourceType =
  | 'browser_context'
  | 'browser_page'
  | 'cdp_session'
  | 'process'
  | 'file_watcher'
  | 'pipe_watcher'
  | 'network_interceptor'
  | 'profiling_session';

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  metadata: Record<string, unknown>;
  cleanup: () => Promise<void> | void;
  healthCheck?: () => Promise<boolean> | boolean;
}

export interface ResourceGroup {
  name: string;
  resources: Map<string, Resource>;
  maxSize: number;
}

export interface ResourceLimits {
  maxBrowserContexts: number;
  maxBrowserPages: number;
  maxProcesses: number;
  maxFileWatchers: number;
  maxCdpSessions: number;
  maxNetworkInterceptors: number;
  maxProfilingSessions: number;
}

export interface HealthReport {
  healthy: boolean;
  totalResources: number;
  byType: Record<string, { count: number; healthy: number; unhealthy: number }>;
  zombieCount: number;
  zombieResources: Array<{ id: string; type: ResourceType; name: string; reason: string }>;
  memoryEstimateMB: number;
}

const DEFAULT_LIMITS: ResourceLimits = {
  maxBrowserContexts: 10,
  maxBrowserPages: 50,
  maxProcesses: 10,
  maxFileWatchers: 20,
  maxCdpSessions: 10,
  maxNetworkInterceptors: 100,
  maxProfilingSessions: 5,
};

export class ResourceManager {
  private groups: Map<ResourceType, ResourceGroup> = new Map();
  private limits: ResourceLimits;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  private idleTimeoutMs: number;

  constructor(limits?: Partial<ResourceLimits>, idleTimeoutSecs = 300) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.idleTimeoutMs = idleTimeoutSecs * 1000;

    // Initialize groups
    this.initGroup('browser_context', this.limits.maxBrowserContexts);
    this.initGroup('browser_page', this.limits.maxBrowserPages);
    this.initGroup('cdp_session', this.limits.maxCdpSessions);
    this.initGroup('process', this.limits.maxProcesses);
    this.initGroup('file_watcher', this.limits.maxFileWatchers);
    this.initGroup('pipe_watcher', this.limits.maxFileWatchers);
    this.initGroup('network_interceptor', this.limits.maxNetworkInterceptors);
    this.initGroup('profiling_session', this.limits.maxProfilingSessions);
  }

  private initGroup(type: ResourceType, maxSize: number): void {
    this.groups.set(type, { name: type, resources: new Map(), maxSize });
  }

  /**
   * Register a new resource for tracking.
   */
  register(resource: Resource): boolean {
    const group = this.groups.get(resource.type);
    if (!group) {
      getLogger().warn({ resourceType: resource.type }, 'ResourceManager: unknown resource type');
      return false;
    }

    // Check capacity
    if (group.resources.size >= group.maxSize) {
      // Try to evict an idle resource
      this.evictIdle(group, resource.type);
    }

    // If still over capacity, fail
    if (group.resources.size >= group.maxSize) {
      getLogger().warn(
        { resourceType: resource.type, maxSize: group.maxSize },
        'ResourceManager: resource limit reached',
      );
      return false;
    }

    group.resources.set(resource.id, resource);
    getLogger().debug(
      { resourceId: resource.id, type: resource.type },
      'ResourceManager: resource registered',
    );
    return true;
  }

  /**
   * Unregister a resource by ID.
   */
  unregister(id: string, type?: ResourceType): boolean {
    if (type) {
      const group = this.groups.get(type);
      if (!group) return false;
      return group.resources.delete(id);
    }

    // Search all groups
    for (const [, group] of this.groups) {
      if (group.resources.delete(id)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get a resource by ID.
   */
  get<T extends Resource = Resource>(id: string, type?: ResourceType): T | null {
    if (type) {
      const group = this.groups.get(type);
      if (!group) return null;
      const resource = group.resources.get(id);
      return (resource as T) ?? null;
    }

    // Search all groups
    for (const [, group] of this.groups) {
      const resource = group.resources.get(id);
      if (resource) return resource as T;
    }
    return null;
  }

  /**
   * Find resources matching a predicate.
   */
  find(predicate: (r: Resource) => boolean): Resource[] {
    const results: Resource[] = [];
    for (const [, group] of this.groups) {
      for (const [, resource] of group.resources) {
        if (predicate(resource)) {
          results.push(resource);
        }
      }
    }
    return results;
  }

  /**
   * Get all resources of a specific type.
   */
  getByType(type: ResourceType): Resource[] {
    const group = this.groups.get(type);
    if (!group) return [];
    return Array.from(group.resources.values());
  }

  /**
   * Get all registered resources.
   */
  getAll(): Resource[] {
    const all: Resource[] = [];
    for (const [, group] of this.groups) {
      for (const [, resource] of group.resources) {
        all.push(resource);
      }
    }
    return all;
  }

  /**
   * Touch/update a resource's lastUsedAt timestamp.
   */
  touch(id: string, type?: ResourceType): boolean {
    const resource = this.get(id, type);
    if (!resource) return false;
    resource.lastUsedAt = Date.now();
    return true;
  }

  /**
   * Cleanup a specific resource (calls its cleanup function and unregisters it).
   */
  async release(id: string, type?: ResourceType): Promise<boolean> {
    const resource = this.get(id, type);
    if (!resource) return false;

    try {
      await resource.cleanup();
    } catch (error) {
      getLogger().error({ resourceId: id, error }, 'ResourceManager: cleanup failed');
    }

    this.unregister(id, type);
    getLogger().debug(
      { resourceId: id, type: resource.type },
      'ResourceManager: resource released',
    );
    return true;
  }

  /**
   * Release all resources.
   */
  async releaseAll(): Promise<void> {
    const all = this.getAll();
    await Promise.allSettled(all.map((r) => this.release(r.id, r.type)));
    getLogger().info({ count: all.length }, 'ResourceManager: all resources released');
  }

  /**
   * Count resources by type.
   */
  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [type, group] of this.groups) {
      counts[type] = group.resources.size;
    }
    return counts;
  }

  /**
   * Total resource count.
   */
  get totalCount(): number {
    let count = 0;
    for (const [, group] of this.groups) {
      count += group.resources.size;
    }
    return count;
  }

  /**
   * Start automatic periodic cleanup of idle resources.
   */
  startAutoCleanup(intervalMs = 60000): void {
    if (this.cleanupIntervalId) return;

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupIdle().catch((error) => {
        getLogger().error({ error }, 'ResourceManager: auto-cleanup failed');
      });
    }, intervalMs);

    getLogger().info({ intervalMs }, 'ResourceManager: auto-cleanup started');
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(intervalMs = 120000): void {
    if (this.healthCheckIntervalId) return;

    this.healthCheckIntervalId = setInterval(async () => {
      const report = await this.runHealthCheck();
      if (!report.healthy) {
        getLogger().warn(
          { zombieCount: report.zombieCount, totalResources: report.totalResources },
          'ResourceManager: health check found issues',
        );
        // Auto-cleanup zombies
        for (const zombie of report.zombieResources) {
          await this.release(zombie.id, zombie.type);
        }
      }
    }, intervalMs);

    getLogger().info({ intervalMs }, 'ResourceManager: health checks started');
  }

  /**
   * Stop automatic cleanup.
   */
  stopAutoCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Stop health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }
  }

  /**
   * Clean up idle resources that haven't been used in a while.
   */
  async cleanupIdle(): Promise<number> {
    const now = Date.now();
    const idle: Resource[] = [];

    for (const [, group] of this.groups) {
      for (const [, resource] of group.resources) {
        if (now - resource.lastUsedAt > this.idleTimeoutMs) {
          idle.push(resource);
        }
      }
    }

    let cleaned = 0;
    for (const resource of idle) {
      try {
        await this.release(resource.id, resource.type);
        cleaned++;
      } catch (error) {
        getLogger().error(
          { resourceId: resource.id, error },
          'ResourceManager: idle cleanup failed',
        );
      }
    }

    if (cleaned > 0) {
      getLogger().info({ cleaned }, 'ResourceManager: idle resources cleaned up');
    }

    return cleaned;
  }

  /**
   * Run a health check on all resources, detecting zombies.
   */
  async runHealthCheck(): Promise<HealthReport> {
    const byType: Record<string, { count: number; healthy: number; unhealthy: number }> = {};
    const zombieResources: Array<{ id: string; type: ResourceType; name: string; reason: string }> =
      [];

    for (const [type, group] of this.groups) {
      let healthy = 0;
      let unhealthy = 0;

      for (const [, resource] of group.resources) {
        if (resource.healthCheck) {
          try {
            const isHealthy = await resource.healthCheck();
            if (isHealthy) {
              healthy++;
            } else {
              unhealthy++;
              zombieResources.push({
                id: resource.id,
                type: resource.type,
                name: resource.name,
                reason: 'Health check failed',
              });
            }
          } catch {
            unhealthy++;
            zombieResources.push({
              id: resource.id,
              type: resource.type,
              name: resource.name,
              reason: 'Health check threw error',
            });
          }
        } else {
          healthy++;
        }
      }

      byType[type] = { count: group.resources.size, healthy, unhealthy };
    }

    const zombieCount = zombieResources.length;
    const totalResources = this.totalCount;

    return {
      healthy: zombieCount === 0,
      totalResources,
      byType,
      zombieCount,
      zombieResources,
      memoryEstimateMB: this.estimateMemoryMB(),
    };
  }

  /**
   * Rough memory estimate based on resource types.
   */
  estimateMemoryMB(): number {
    let estimate = 0;
    const counts = this.countByType();

    // Rough per-resource memory estimates
    estimate += (counts.browser_context ?? 0) * 20; // ~20MB per context
    estimate += (counts.browser_page ?? 0) * 15; // ~15MB per page
    estimate += (counts.cdp_session ?? 0) * 1; // ~1MB per CDP session
    estimate += (counts.process ?? 0) * 5; // ~5MB per process tracking
    estimate += (counts.file_watcher ?? 0) * 0.5; // ~0.5MB per file watcher
    estimate += (counts.network_interceptor ?? 0) * 0.1; // ~0.1MB per interceptor

    return Math.round(estimate);
  }

  /**
   * Evict the oldest idle resource from a group.
   */
  private evictIdle(group: ResourceGroup, type: ResourceType): void {
    let oldest: Resource | null = null;
    let oldestTime = Infinity;

    for (const [, resource] of group.resources) {
      if (resource.lastUsedAt < oldestTime) {
        oldestTime = resource.lastUsedAt;
        oldest = resource;
      }
    }

    if (oldest && Date.now() - oldest.lastUsedAt > 60000) {
      // Only evict if idle for at least 60 seconds
      this.release(oldest.id, type).catch(() => {});
    }
  }
}
