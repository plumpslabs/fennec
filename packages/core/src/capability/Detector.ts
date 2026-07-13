import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getLogger } from '../utils/logger.js';

export interface FrameworkCapability {
  name: string;
  detected: boolean;
  confidence: number;
  version?: string;
  category: 'frontend' | 'backend' | 'mobile' | 'tooling' | 'database';
  features: string[];
}

export interface EnvironmentCapability {
  hasDocker: boolean;
  hasNode: boolean;
  hasPython: boolean;
  hasGit: boolean;
  hasADB: boolean;
  hasVercelCLI: boolean;
  platform: string;
  shell: string;
}

export interface CapabilityReport {
  frameworks: FrameworkCapability[];
  environment: EnvironmentCapability;
  primaryFramework?: FrameworkCapability;
  recommendedModules: string[];
}

const FRAMEWORK_DETECTORS: Array<{
  name: string;
  category: FrameworkCapability['category'];
  detect: (cwd: string) => {
    detected: boolean;
    confidence: number;
    version?: string;
    features: string[];
  };
}> = [
  {
    name: 'Next.js',
    category: 'frontend',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) {
          return {
            detected: true,
            confidence: 0.95,
            version: deps.next.replace('^', '').replace('~', ''),
            features: ['SSR', 'SSG', 'API Routes', 'File-based Routing'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'React',
    category: 'frontend',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react && !deps.next) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps.react.replace('^', '').replace('~', ''),
            features: ['SPA', 'Components', 'Hooks'],
          };
        }
        if (deps.react) {
          return {
            detected: true,
            confidence: 0.7,
            version: deps.react.replace('^', '').replace('~', ''),
            features: ['Components', 'Hooks'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Vue.js',
    category: 'frontend',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vue || deps['nuxt']) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps.vue?.replace('^', '').replace('~', '') ?? 'unknown',
            features: deps['nuxt'] ? ['SSR', 'File-based Routing'] : ['SPA', 'Components'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Express.js',
    category: 'backend',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.express) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps.express.replace('^', '').replace('~', ''),
            features: ['REST API', 'Middleware'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Vite',
    category: 'tooling',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vite) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps.vite.replace('^', '').replace('~', ''),
            features: ['HMR', 'Fast Build', 'Dev Server'],
          };
        }
        if (existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) {
          return {
            detected: true,
            confidence: 0.85,
            version: undefined,
            features: ['HMR', 'Dev Server'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Laravel',
    category: 'backend',
    detect: (cwd) => {
      try {
        if (existsSync(join(cwd, 'artisan'))) {
          const composer = JSON.parse(readFileSync(join(cwd, 'composer.json'), 'utf-8'));
          const version = composer.require?.['laravel/framework'] ?? 'unknown';
          return {
            detected: true,
            confidence: 0.95,
            version: version.replace('^', '').replace('~', ''),
            features: ['MVC', 'Eloquent ORM', 'Artisan CLI'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Expo / React Native',
    category: 'mobile',
    detect: (cwd) => {
      try {
        if (existsSync(join(cwd, 'app.json')) || existsSync(join(cwd, 'app.config.js'))) {
          return {
            detected: true,
            confidence: 0.9,
            version: undefined,
            features: ['Mobile', 'Cross-platform'],
          };
        }
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['react-native'] || deps.expo) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps['react-native']?.replace('^', '').replace('~', ''),
            features: ['Mobile', 'Native APIs'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Prisma',
    category: 'database',
    detect: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.prisma || deps['@prisma/client']) {
          return {
            detected: true,
            confidence: 0.9,
            version: deps.prisma?.replace('^', '').replace('~', ''),
            features: ['ORM', 'Migrations', 'Type Safety'],
          };
        }
        if (existsSync(join(cwd, 'prisma/schema.prisma'))) {
          return {
            detected: true,
            confidence: 0.85,
            version: undefined,
            features: ['ORM', 'Schema'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Flutter',
    category: 'mobile',
    detect: (cwd) => {
      try {
        if (existsSync(join(cwd, 'pubspec.yaml'))) {
          return {
            detected: true,
            confidence: 0.95,
            version: undefined,
            features: ['Mobile', 'Cross-platform', 'Dart'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
  {
    name: 'Docker',
    category: 'tooling',
    detect: (cwd) => {
      try {
        if (
          existsSync(join(cwd, 'Dockerfile')) ||
          existsSync(join(cwd, 'docker-compose.yml')) ||
          existsSync(join(cwd, 'docker-compose.yaml'))
        ) {
          return {
            detected: true,
            confidence: 0.9,
            version: undefined,
            features: ['Containerization', 'Dev Environment'],
          };
        }
      } catch {
        /* ignore */
      }
      return { detected: false, confidence: 0, features: [] };
    },
  },
];

export class CapabilityDetector {
  private cachedReport: CapabilityReport | null = null;

  async detect(cwd: string): Promise<CapabilityReport> {
    if (this.cachedReport) return this.cachedReport;

    const logger = getLogger();
    logger.info('CapabilityDetector: detecting project capabilities');

    const frameworks = FRAMEWORK_DETECTORS.map((detector) => {
      const result = detector.detect(cwd);
      return {
        name: detector.name,
        detected: result.detected,
        confidence: result.confidence,
        version: result.version,
        category: detector.category,
        features: result.features,
      };
    });

    const detectedFrameworks = frameworks
      .filter((f) => f.detected)
      .sort((a, b) => b.confidence - a.confidence);

    const environment = await this.detectEnvironment();

    // Determine recommended modules based on detected frameworks
    const recommendedModules = this.getRecommendedModules(detectedFrameworks);

    const report: CapabilityReport = {
      frameworks,
      environment,
      primaryFramework: detectedFrameworks[0],
      recommendedModules,
    };

    this.cachedReport = report;
    return report;
  }

  /**
   * Detect environment capabilities.
   */
  async detectEnvironment(): Promise<EnvironmentCapability> {
    const { execSync } = await import('node:child_process');

    const check = (cmd: string): boolean => {
      try {
        execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 2000 });
        return true;
      } catch {
        return false;
      }
    };

    return {
      hasDocker: check('docker'),
      hasNode: check('node'),
      hasPython: check('python3') || check('python'),
      hasGit: check('git'),
      hasADB: check('adb'),
      hasVercelCLI: check('vercel'),
      platform: process.platform,
      shell: process.env.SHELL ?? 'unknown',
    };
  }

  /**
   * Get recommended modules based on detected frameworks.
   */
  private getRecommendedModules(frameworks: FrameworkCapability[]): string[] {
    const modules: string[] = [];

    for (const fw of frameworks) {
      switch (fw.name) {
        case 'Next.js':
          modules.push('SSR Debugging', 'API Route Monitoring', 'ISR Cache Inspection');
          break;
        case 'Laravel':
          modules.push('Artisan Command Runner', 'Eloquent Debug', 'Log Viewer');
          break;
        case 'Expo / React Native':
          modules.push('Mobile Device Preview', 'LogCat Reader', 'Expo Go Integration');
          break;
        case 'Docker':
          modules.push('Container Log Stream', 'Docker Compose Manager');
          break;
        case 'Prisma':
          modules.push('Query Inspector', 'Migration Runner');
          break;
        case 'Flutter':
          modules.push('Flutter Device Manager', 'Dart Debugger');
          break;
      }
    }

    return modules;
  }

  clearCache(): void {
    this.cachedReport = null;
  }
}
