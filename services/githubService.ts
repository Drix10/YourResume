import { GitHubRepo, GitHubUser, EnrichedRepoData } from '../types';
import { GITHUB_API } from '../constants';

const BASE_URL = GITHUB_API.BASE_URL;

// Base64 decode with browser and Node.js compatibility
const base64Decode = (str: string): string => {
  try {
    // Browser environment
    if (typeof atob === 'function') {
      return atob(str);
    }
    // Node.js environment fallback
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'base64').toString('utf-8');
    }
    throw new Error('No base64 decoder available');
  } catch {
    return '';
  }
};

// Helper to fetch file content from repo with timeout and size limit
const fetchFileContent = async (
  token: string,
  owner: string,
  repo: string,
  path: string,
  timeoutMs: number = 5000,
  maxSizeBytes: number = 1024 * 1024 // 1MB limit
): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(
      `${BASE_URL}/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();

    // Check file size before decoding
    if (data.size && data.size > maxSizeBytes) {
      console.warn(`File ${path} too large (${data.size} bytes), skipping`);
      return null;
    }

    // GitHub returns base64 encoded content
    if (data.content && data.encoding === 'base64') {
      try {
        const decoded = base64Decode(data.content.replace(/\n/g, ''));
        // Double-check decoded size
        if (decoded.length > maxSizeBytes) {
          console.warn(`Decoded file ${path} too large, skipping`);
          return null;
        }
        return decoded;
      } catch (decodeError) {
        console.error(`Failed to decode ${path}:`, decodeError);
        return null;
      }
    }

    return null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn(`Timeout fetching ${path}`);
    }
    return null;
  }
};

// Parse package.json to extract meaningful info with validation
const parsePackageJson = (content: string): {
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
  description?: string;
} | null => {
  try {
    // Validate content length
    if (!content || content.length > 500000) { // 500KB limit for package.json
      return null;
    }

    const pkg = JSON.parse(content);

    // Validate it's actually a package.json-like object
    if (typeof pkg !== 'object' || pkg === null) {
      return null;
    }

    return {
      dependencies: Object.keys(pkg.dependencies || {}).slice(0, 200), // Limit deps
      devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 200),
      scripts: Object.keys(pkg.scripts || {}).slice(0, 50),
      description: typeof pkg.description === 'string' ? pkg.description.slice(0, 500) : undefined,
    };
  } catch {
    return null;
  }
};

// Parse requirements.txt to extract dependencies with validation
const parseRequirementsTxt = (content: string): string[] => {
  if (!content || content.length > 100000) { // 100KB limit
    return [];
  }

  return content
    .split('\n')
    .slice(0, 500) // Limit lines
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.length < 200) // Sanity check
    .map(line => {
      // Extract package name (before ==, >=, etc.)
      const match = line.match(/^([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    })
    .filter((pkg): pkg is string => pkg !== null && pkg.length > 0 && pkg.length < 100);
};

// Parse go.mod for Go projects
const parseGoMod = (content: string): string[] => {
  if (!content || content.length > 100000) return [];

  const deps: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match require statements: require github.com/pkg/name v1.0.0
    const requireMatch = line.match(/^\s*(?:require\s+)?([a-zA-Z0-9._/-]+)\s+v/);
    if (requireMatch) {
      // Extract just the package name (last part of path)
      const parts = requireMatch[1].split('/');
      const pkgName = parts[parts.length - 1];
      if (pkgName && pkgName.length < 50) deps.push(pkgName);
    }
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse Cargo.toml for Rust projects
const parseCargoToml = (content: string): string[] => {
  if (!content || content.length > 100000) return [];

  const deps: string[] = [];
  const lines = content.split('\n');
  let inDeps = false;

  for (const line of lines) {
    if (/^\[dependencies\]/.test(line) || /^\[dev-dependencies\]/.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^\[/.test(line)) {
      inDeps = false;
      continue;
    }
    if (inDeps) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (match && match[1].length < 50) deps.push(match[1]);
    }
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse pom.xml for Java/Maven projects
const parsePomXml = (content: string): string[] => {
  if (!content || content.length > 500000) return [];

  const deps: string[] = [];
  // Extract artifactId from dependencies
  const matches = content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g);
  for (const match of matches) {
    if (match[1] && match[1].length < 50 && !match[1].includes('$')) {
      deps.push(match[1]);
    }
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse build.gradle for Java/Gradle projects
const parseBuildGradle = (content: string): string[] => {
  if (!content || content.length > 200000) return [];

  const deps: string[] = [];
  // Match implementation 'group:artifact:version' or implementation "group:artifact:version"
  const matches = content.matchAll(/(?:implementation|compile|api|testImplementation)\s*['"(]([^'"():]+):([^'"():]+)/g);
  for (const match of matches) {
    if (match[2] && match[2].length < 50) {
      deps.push(match[2]); // artifact name
    }
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse Gemfile for Ruby projects
const parseGemfile = (content: string): string[] => {
  if (!content || content.length > 100000) return [];

  const deps: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match gem 'name' or gem "name"
    const match = line.match(/^\s*gem\s+['"]([a-zA-Z0-9_-]+)['"]/);
    if (match && match[1].length < 50) deps.push(match[1]);
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse CMakeLists.txt for C/C++ projects
const parseCMakeLists = (content: string): string[] => {
  if (!content || content.length > 200000) return [];

  const deps: string[] = [];
  // Extract find_package and target_link_libraries
  const findPkgMatches = content.matchAll(/find_package\s*\(\s*([a-zA-Z0-9_]+)/gi);
  for (const match of findPkgMatches) {
    if (match[1] && match[1].length < 50) deps.push(match[1]);
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse Jupyter notebook for ML/Data Science projects
const parseJupyterNotebook = (content: string): { imports: string[]; isML: boolean; isDataScience: boolean } => {
  if (!content || content.length > 5000000) return { imports: [], isML: false, isDataScience: false }; // 5MB limit for notebooks

  try {
    const notebook = JSON.parse(content);
    const imports: string[] = [];
    let isML = false;
    let isDataScience = false;

    const cells = notebook.cells || [];
    for (const cell of cells) {
      if (cell.cell_type !== 'code') continue;

      const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source || '';

      // Extract imports
      const importMatches = source.matchAll(/(?:import|from)\s+([a-zA-Z0-9_]+)/g);
      for (const match of importMatches) {
        if (match[1] && match[1].length < 50) imports.push(match[1]);
      }
    }

    const uniqueImports = [...new Set(imports)];

    // Detect ML libraries
    const mlLibs = ['tensorflow', 'torch', 'pytorch', 'keras', 'sklearn', 'xgboost', 'lightgbm', 'transformers', 'huggingface'];
    isML = uniqueImports.some(imp => mlLibs.includes(imp.toLowerCase()));

    // Detect Data Science libraries
    const dsLibs = ['pandas', 'numpy', 'matplotlib', 'seaborn', 'plotly', 'scipy', 'statsmodels'];
    isDataScience = uniqueImports.some(imp => dsLibs.includes(imp.toLowerCase()));

    return { imports: uniqueImports.slice(0, 100), isML, isDataScience };
  } catch {
    return { imports: [], isML: false, isDataScience: false };
  }
};

// Parse setup.py for Python projects
const parseSetupPy = (content: string): string[] => {
  if (!content || content.length > 100000) return [];

  const deps: string[] = [];
  // Match install_requires list
  const requiresMatch = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
  if (requiresMatch) {
    const matches = requiresMatch[1].matchAll(/['"]([a-zA-Z0-9_-]+)/g);
    for (const match of matches) {
      if (match[1] && match[1].length < 50) deps.push(match[1]);
    }
  }

  return [...new Set(deps)].slice(0, 100);
};

// Parse pyproject.toml for modern Python projects
const parsePyprojectToml = (content: string): string[] => {
  if (!content || content.length > 100000) return [];

  const deps: string[] = [];
  // Match dependencies in various formats
  const matches = content.matchAll(/["']([a-zA-Z0-9_-]+)(?:[><=!~]|["'])/g);
  for (const match of matches) {
    if (match[1] && match[1].length < 50 && match[1].length > 1) deps.push(match[1]);
  }

  return [...new Set(deps)].slice(0, 100);
};

// Extract key info from README
const parseReadme = (content: string): {
  hasDemo: boolean;
  hasDocs: boolean;
  mentions: string[];
  projectType: string;
  hasMetrics: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
} => {
  // Limit content size to prevent regex performance issues
  const maxContentLength = 50000; // 50KB max for parsing
  const truncatedContent = content.length > maxContentLength
    ? content.slice(0, maxContentLength)
    : content;
  const lower = truncatedContent.toLowerCase();

  // Detect project type
  let projectType = 'application';
  if (/library|package|npm|pypi|gem/.test(lower)) projectType = 'library';
  if (/api|backend|server|microservice/.test(lower)) projectType = 'api';
  if (/cli|command.?line|terminal/.test(lower)) projectType = 'cli-tool';
  if (/dashboard|admin|panel/.test(lower)) projectType = 'dashboard';
  if (/mobile|ios|android|react.?native/.test(lower)) projectType = 'mobile-app';
  if (/website|landing|portfolio/.test(lower)) projectType = 'website';

  // Detect metrics/scale mentions
  const hasMetrics = /\d+\+?\s*(users|requests|downloads|stars|contributors|companies)/i.test(content);

  // Estimate complexity
  const wordCount = content.split(/\s+/).length;
  const hasDiagrams = /!\[.*\]\(.*\)/g.test(content); // Has images
  const hasSections = (content.match(/^#{2,3}\s/gm) || []).length; // H2/H3 headers

  let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
  if (wordCount > 500 || hasSections > 5) complexity = 'moderate';
  if (wordCount > 1500 || hasSections > 10 || hasDiagrams) complexity = 'complex';

  // Extract and sanitize technology mentions
  const techMatches = content.match(/\b(react|vue|angular|svelte|next\.?js|nuxt|node\.?js|express|koa|fastify|django|flask|fastapi|spring|laravel|rails|docker|kubernetes|aws|gcp|azure|heroku|vercel|netlify|postgresql|mysql|mongodb|redis|elasticsearch|graphql|rest\s?api|grpc|typescript|javascript|python|java|go|golang|rust|c\+\+|swift|kotlin|php|ruby|terraform|ansible|jenkins|github\s?actions|ci\/cd|webpack|vite|rollup|jest|mocha|pytest|junit)\b/gi) || [];

  const sanitizedMentions = [...new Set(techMatches)]
    .map(m => m.toLowerCase())
    .filter(m => m.length > 1 && m.length < 50) // Sanity check
    .slice(0, 50); // Limit to 50 mentions

  return {
    hasDemo: /demo|live|deployed|website|app\.|production/.test(lower),
    hasDocs: /documentation|docs|api reference|wiki/.test(lower),
    mentions: sanitizedMentions,
    projectType,
    hasMetrics,
    complexity,
  };
};

// Fetch commit count for a repo AND user's contribution count
const fetchCommitCount = async (
  token: string,
  owner: string,
  repo: string,
  username?: string,
  timeoutMs: number = 10000
): Promise<{ total: number; userContributions: number }> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let allContributors: any[] = [];
    let page = 1;
    const maxPages = 3; // Fetch up to 300 contributors (3 pages * 100)

    // Paginate through contributors to ensure we find the user
    while (page <= maxPages) {
      const response = await fetch(
        `${BASE_URL}/repos/${owner}/${repo}/contributors?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        clearTimeout(timeoutId);
        break;
      }

      const contributors = await response.json();

      // Validate response is an array
      if (!Array.isArray(contributors) || contributors.length === 0) break;

      allContributors = [...allContributors, ...contributors];

      // If we found the user and got less than 100 results, we can stop
      if (username && contributors.some((c: any) => c.login?.toLowerCase() === username.toLowerCase())) {
        if (contributors.length < 100) break;
      }

      // Stop if we got less than 100 (last page)
      if (contributors.length < 100) break;

      page++;
    }

    // Clear timeout after all fetches complete
    clearTimeout(timeoutId);

    // Validate we have contributors
    if (!Array.isArray(allContributors) || allContributors.length === 0) {
      return { total: 0, userContributions: 0 };
    }

    // Calculate total commits
    const total = allContributors.reduce((sum: number, c: any) => {
      const contributions = typeof c?.contributions === 'number' ? c.contributions : 0;
      return sum + contributions;
    }, 0);

    // Find user's contribution count
    let userContributions = 0;
    if (username && username.trim().length > 0) {
      const usernameLower = username.toLowerCase().trim();
      const userContributor = allContributors.find((c: any) =>
        c?.login?.toLowerCase().trim() === usernameLower
      );
      userContributions = typeof userContributor?.contributions === 'number'
        ? userContributor.contributions
        : 0;
    }

    return { total, userContributions };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn(`Timeout fetching commits for ${owner}/${repo}`);
    } else {
      console.error(`Error fetching commits for ${owner}/${repo}:`, error);
    }
    return { total: 0, userContributions: 0 };
  }
};

// Fetch languages breakdown for a repo
const fetchLanguages = async (
  token: string,
  owner: string,
  repo: string,
  timeoutMs: number = 5000
): Promise<Record<string, number>> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(
      `${BASE_URL}/repos/${owner}/${repo}/languages`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) return {};

    const data = await response.json();
    // Validate response is an object
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return {};
    }
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn(`Timeout fetching languages for ${owner}/${repo}`);
    }
    return {};
  }
};

// Enrich repo with deep analysis - with error handling and parallel processing
export const enrichRepoData = async (
  token: string,
  repos: GitHubRepo[],
  username: string,
  limit: number = 10
): Promise<EnrichedRepoData[]> => {
  // Only enrich top repos to avoid rate limits
  const topRepos = repos.slice(0, limit);

  // Process all repos in parallel (with individual error handling)
  const enrichmentPromises = topRepos.map(async (repo) => {
    try {
      // Safe split with validation
      const parts = repo.full_name.split('/');
      if (parts.length < 2) {
        console.error(`Invalid repo full_name format: ${repo.full_name}`);
        return { ...repo, enrichedData: undefined };
      }
      const owner = parts[0];
      const repoName = parts.slice(1).join('/'); // Handle edge case of repo names with slashes

      // Fetch multiple data sources in parallel for this repo
      // Group 1: Core files (always fetch)
      const [packageJson, requirementsTxt, readme, readmeMd, commitData, languages] = await Promise.all([
        fetchFileContent(token, owner, repoName, 'package.json'),
        fetchFileContent(token, owner, repoName, 'requirements.txt'),
        fetchFileContent(token, owner, repoName, 'README.md'),
        fetchFileContent(token, owner, repoName, 'readme.md'),
        fetchCommitCount(token, owner, repoName, username),
        fetchLanguages(token, owner, repoName),
      ]);

      // Group 2: Language-specific files (fetch based on detected languages)
      const langKeys = Object.keys(languages).map(l => l.toLowerCase());

      // Fetch additional dependency files based on detected languages
      const additionalFetches: Promise<string | null>[] = [];
      const fetchTypes: string[] = [];

      // Go
      if (langKeys.includes('go')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'go.mod'));
        fetchTypes.push('goMod');
      }
      // Rust
      if (langKeys.includes('rust')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'Cargo.toml'));
        fetchTypes.push('cargoToml');
      }
      // Java
      if (langKeys.includes('java')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'pom.xml'));
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'build.gradle'));
        fetchTypes.push('pomXml', 'buildGradle');
      }
      // Ruby
      if (langKeys.includes('ruby')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'Gemfile'));
        fetchTypes.push('gemfile');
      }
      // C/C++
      if (langKeys.includes('c') || langKeys.includes('c++') || langKeys.includes('cmake')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'CMakeLists.txt'));
        fetchTypes.push('cmakeLists');
      }
      // Python (additional files)
      if (langKeys.includes('python') || langKeys.includes('jupyter notebook')) {
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'setup.py'));
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'pyproject.toml'));
        fetchTypes.push('setupPy', 'pyprojectToml');
      }
      // Jupyter Notebook - try to find one
      if (langKeys.includes('jupyter notebook')) {
        // We'll check for common notebook names
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'main.ipynb', 5000, 5000000));
        additionalFetches.push(fetchFileContent(token, owner, repoName, 'notebook.ipynb', 5000, 5000000));
        fetchTypes.push('notebook1', 'notebook2');
      }

      const additionalResults = await Promise.all(additionalFetches);

      // Map results to their types
      const additionalFiles: Record<string, string | null> = {};
      fetchTypes.forEach((type, i) => {
        additionalFiles[type] = additionalResults[i];
      });

      const readmeContent = readme || readmeMd || '';
      const packageData = packageJson ? parsePackageJson(packageJson) : null;
      const pythonDeps = requirementsTxt ? parseRequirementsTxt(requirementsTxt) : [];
      const readmeData = readmeContent ? parseReadme(readmeContent) : {
        hasDemo: false,
        hasDocs: false,
        mentions: [],
        projectType: 'application',
        hasMetrics: false,
        complexity: 'simple' as const
      };

      // Parse additional dependency files
      const goDeps = additionalFiles.goMod ? parseGoMod(additionalFiles.goMod) : [];
      const rustDeps = additionalFiles.cargoToml ? parseCargoToml(additionalFiles.cargoToml) : [];
      const javaDeps = [
        ...(additionalFiles.pomXml ? parsePomXml(additionalFiles.pomXml) : []),
        ...(additionalFiles.buildGradle ? parseBuildGradle(additionalFiles.buildGradle) : []),
      ];
      const rubyDeps = additionalFiles.gemfile ? parseGemfile(additionalFiles.gemfile) : [];
      const cppDeps = additionalFiles.cmakeLists ? parseCMakeLists(additionalFiles.cmakeLists) : [];
      const setupPyDeps = additionalFiles.setupPy ? parseSetupPy(additionalFiles.setupPy) : [];
      const pyprojectDeps = additionalFiles.pyprojectToml ? parsePyprojectToml(additionalFiles.pyprojectToml) : [];

      // Parse Jupyter notebooks
      const notebookContent = additionalFiles.notebook1 || additionalFiles.notebook2;
      const notebookData = notebookContent ? parseJupyterNotebook(notebookContent) : { imports: [], isML: false, isDataScience: false };

      // Detect project type based on dependencies
      let detectedProjectType = readmeData.projectType;
      if (notebookData.isML) detectedProjectType = 'ml-project';
      else if (notebookData.isDataScience) detectedProjectType = 'data-science';

      // Calculate language diversity score
      const languageCount = Object.keys(languages).length;
      const totalBytes = Object.values(languages).reduce((sum: number, bytes: number) => sum + bytes, 0);

      return {
        ...repo,
        enrichedData: {
          packageJson: packageData,
          pythonDependencies: [...pythonDeps, ...setupPyDeps, ...pyprojectDeps],
          commitCount: commitData.total,
          userCommitCount: commitData.userContributions,
          languages,
          languageCount,
          totalCodeBytes: totalBytes,
          readme: {
            length: readmeContent.length,
            hasDemo: readmeData.hasDemo,
            hasDocs: readmeData.hasDocs,
            techMentions: readmeData.mentions,
            projectType: detectedProjectType,
            hasMetrics: readmeData.hasMetrics,
            complexity: readmeData.complexity,
          },
          // ML/Data Science indicators
          isMLProject: notebookData.isML,
          isDataScience: notebookData.isDataScience,
          // Combine all tech stack info from all ecosystems
          detectedTechnologies: [
            ...(packageData?.dependencies || []),
            ...(packageData?.devDependencies || []),
            ...pythonDeps,
            ...setupPyDeps,
            ...pyprojectDeps,
            ...goDeps,
            ...rustDeps,
            ...javaDeps,
            ...rubyDeps,
            ...cppDeps,
            ...notebookData.imports,
            ...readmeData.mentions,
          ].filter((v, i, a) => a.indexOf(v) === i), // Unique
        },
      };
    } catch (error) {
      // If enrichment fails for a repo, return it without enriched data
      console.error(`Failed to enrich repo ${repo.name}:`, error);
      return {
        ...repo,
        enrichedData: undefined,
      };
    }
  });

  // Wait for all enrichments to complete
  const enrichedRepos = await Promise.all(enrichmentPromises);

  return enrichedRepos;
};

export const validateToken = async (token: string): Promise<GitHubUser> => {
  if (!token || token.trim().length === 0) {
    throw new Error('GitHub token is required');
  }

  // Basic token format validation
  const trimmedToken = token.trim();
  if (trimmedToken.length < 10) {
    throw new Error('Invalid GitHub token format');
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/user`, {
      headers: {
        Authorization: `token ${trimmedToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
  } catch (networkError) {
    throw new Error('Network error: Unable to connect to GitHub. Please check your internet connection.');
  }

  if (response.status === 401) {
    throw new Error('Invalid or expired GitHub token. Please generate a new token.');
  }

  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded or token lacks required permissions.');
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const fetchAllRepos = async (token: string, username: string): Promise<GitHubRepo[]> => {
  if (!token || !username) {
    throw new Error('Token and username are required');
  }

  const trimmedToken = token.trim();
  const trimmedUsername = username.trim();

  let page = 1;
  let repos: GitHubRepo[] = [];
  const perPage = GITHUB_API.REPOS_PER_PAGE;
  const MAX_PAGES = GITHUB_API.MAX_PAGES;

  while (page <= MAX_PAGES) {
    let response: Response;

    try {
      response = await fetch(`${BASE_URL}/user/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`, {
        headers: {
          Authorization: `token ${trimmedToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
    } catch (networkError) {
      console.error("Network error fetching repos:", networkError);
      if (repos.length > 0) break; // Return what we have
      throw new Error('Network error: Unable to fetch repositories. Please check your internet connection.');
    }

    if (response.status === 403 || response.status === 429) {
      if (repos.length > 0) break; // Return what we have
      throw new Error("GitHub API Rate Limit Exceeded. Please try again later.");
    }

    if (response.ok) {
      let data: GitHubRepo[];
      try {
        data = await response.json();
      } catch (parseError) {
        console.error("Error parsing repo response:", parseError);
        break;
      }

      if (!Array.isArray(data) || data.length === 0) break;
      repos = [...repos, ...data];
      if (data.length < perPage) break;
    } else {
      // Fallback to public only if /user/repos fails (likely due to scope)
      if (page === 1) {
        try {
          const publicResponse = await fetch(`${BASE_URL}/users/${trimmedUsername}/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`, {
            headers: {
              Authorization: `token ${trimmedToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });

          if (publicResponse.ok) {
            const data = await publicResponse.json();
            if (!Array.isArray(data) || data.length === 0) break;
            repos = [...repos, ...data];
            if (data.length < perPage) break;
          } else {
            break;
          }
        } catch (fallbackError) {
          console.error("Error in fallback repo fetch:", fallbackError);
          break;
        }
      } else {
        break;
      }
    }

    page++;
  }

  // Deduplicate by repo ID
  const uniqueRepos = Array.from(new Map(repos.map(item => [item.id, item])).values());

  // CRITICAL FILTERING: Remove repos where user has no meaningful contribution
  // This filters out org repos, famous forks, and repos user didn't actually work on
  const userRelevantRepos = uniqueRepos.filter(repo => {
    // Validate repo.full_name exists
    if (!repo.full_name || typeof repo.full_name !== 'string') {
      console.warn(`Missing or invalid repo full_name`);
      return false;
    }

    // Safe split with validation
    const parts = repo.full_name.split('/');
    if (parts.length < 2) {
      console.warn(`Invalid repo full_name format: ${repo.full_name}`);
      return false; // Skip malformed repos
    }
    const owner = parts[0];
    const ownerLower = owner.toLowerCase().trim();
    const usernameLower = trimmedUsername.toLowerCase().trim();

    // Determine if user owns this repo
    const isOwnRepo = ownerLower === usernameLower ||
      repo.owner?.login?.toLowerCase().trim() === usernameLower;

    // KEEP: User owns the repo (personal repos) - but check fork status below
    if (isOwnRepo && !repo.fork) {
      return true; // Keep all non-fork repos owned by user
    }

    // REMOVE: ALL forked repos from orgs (likely just cloned, not contributed)
    if (repo.fork && !isOwnRepo) {
      return false; // Never include org forks
    }

    // REMOVE: Own forks unless they have significant activity
    // This filters out tutorial/learning repos that were just forked
    if (repo.fork && isOwnRepo) {
      // Only keep own forks if they have substantial stars or forks (indicating real work)
      const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;
      const forks = typeof repo.forks_count === 'number' ? repo.forks_count : 0;

      // Keep only if fork has gained community traction (20+ stars OR 10+ forks)
      // This indicates significant improvements over the original
      if (stars < 20 && forks < 10) {
        return false; // Filter out learning/tutorial forks
      }
    }

    // KEEP: Org repos where user might be a contributor
    // These will be filtered later based on actual commit count
    return true;
  });

  return userRelevantRepos;
};

// Smart repo scoring that works for both public and private repos
export const scoreAndSortRepos = (repos: EnrichedRepoData[], username: string): EnrichedRepoData[] => {
  const usernameLower = username.toLowerCase();

  return repos
    .map(repo => {
      let score = 0;
      const data = repo.enrichedData;

      // Safe split with validation
      const parts = repo.full_name.split('/');
      if (parts.length < 2) {
        console.warn(`Invalid repo full_name format: ${repo.full_name}`);
        return { ...repo, calculatedScore: 0 };
      }
      const owner = parts[0];
      const isOwnRepo = owner.toLowerCase().trim() === usernameLower;

      // If enrichment failed, use basic scoring
      if (!data) {
        // Basic fallback scoring with type safety
        const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;
        const forks = typeof repo.forks_count === 'number' ? repo.forks_count : 0;

        if (repo.private !== true && stars > 10) score += 30;
        if (forks > 5) score += 20;

        // Safe date parsing
        let daysSinceUpdate = Infinity;
        try {
          const updateDate = new Date(repo.updated_at);
          if (!isNaN(updateDate.getTime())) {
            daysSinceUpdate = (Date.now() - updateDate.getTime()) / (1000 * 60 * 60 * 24);
          }
        } catch {
          // Invalid date, use default
        }

        if (daysSinceUpdate < 90) score += 10;

        // Give own repos a baseline score even without enrichment
        if (isOwnRepo) score += 20;

        // Penalize forks even in fallback scoring
        if (repo.fork === true) {
          score -= 200; // Heavy penalty for forks without enrichment data
        }

        return { ...repo, calculatedScore: Math.max(0, score) };
      }

      // === USER CONTRIBUTION ANALYSIS (CRITICAL FOR ORG REPOS) ===
      const userCommits = typeof data.userCommitCount === 'number' ? data.userCommitCount : 0;
      const totalCommits = typeof data.commitCount === 'number' ? data.commitCount : 0;

      // Safe division with edge case handling
      let contributionRatio = 0;
      if (totalCommits > 0 && userCommits >= 0) {
        contributionRatio = Math.min(userCommits / totalCommits, 1.0); // Cap at 100%
      } else if (totalCommits === 0 && userCommits > 0) {
        // Edge case: user has commits but total is 0 (data inconsistency)
        contributionRatio = 1.0; // Assume 100% contribution
      }

      // CRITICAL: Filter forks and org repos based on user's actual commits
      // Note: Own non-fork repos are NEVER removed (even with 0 commits - could be new repos)
      if (!isOwnRepo) {
        // ORG REPOS: Must have actual commits to be included
        if (userCommits === 0) {
          return { ...repo, calculatedScore: -9999 }; // Will be filtered out
        }
        // If user has less than 3 commits, heavily penalize (likely just minor contributions)
        if (userCommits < 3) {
          score -= 300; // Almost certainly not resume-worthy
        }
        // If user has less than 10 commits OR less than 10% contribution, heavily penalize
        else if (userCommits < 10 || contributionRatio < 0.1) {
          score -= 200; // Effectively removes from top results
        }
        // If user has less than 20 commits OR less than 25% contribution, penalize
        else if (userCommits < 20 || contributionRatio < 0.25) {
          score -= 100; // Significant penalty for minor contributions
        }
      } else if (repo.fork) {
        // OWN FORKS: Must have actual commits to be included
        if (userCommits === 0) {
          return { ...repo, calculatedScore: -9999 }; // Will be filtered out
        }
        // Own forks with minimal commits are not impressive
        if (userCommits < 10) {
          score -= 250; // Heavy penalty for forks with little work
        } else if (userCommits < 30) {
          score -= 150; // Moderate penalty
        }
      }
      // OWN NON-FORK REPOS: Always keep (even with 0 commits - could be new/WIP)

      // === COMMIT ACTIVITY (Use USER's commits for org repos, total for own repos) ===
      // More commits = more work invested
      const relevantCommits = isOwnRepo ? totalCommits : userCommits;

      if (relevantCommits > 500) score += 100;
      else if (relevantCommits > 200) score += 80;
      else if (relevantCommits > 100) score += 60;
      else if (relevantCommits > 50) score += 40;
      else if (relevantCommits > 20) score += 20;
      else if (relevantCommits > 5) score += 10;

      // === CODE SIZE & COMPLEXITY ===
      // Larger codebase = more substantial project (with type safety)
      const codeBytes = typeof data?.totalCodeBytes === 'number' ? data.totalCodeBytes : 0;
      const codeKB = codeBytes > 0 ? codeBytes / 1024 : 0;
      if (codeKB > 1000) score += 50; // 1MB+
      else if (codeKB > 500) score += 40;
      else if (codeKB > 200) score += 30;
      else if (codeKB > 100) score += 20;
      else if (codeKB > 50) score += 10;

      // === LANGUAGE DIVERSITY ===
      // Multiple languages = full-stack or complex architecture (with type safety)
      const langCount = typeof data?.languageCount === 'number' ? data.languageCount : 0;
      if (langCount >= 5) score += 30;
      else if (langCount >= 3) score += 20;
      else if (langCount >= 2) score += 10;

      // === README QUALITY ===
      // Good documentation = professional project (with type safety)
      const readmeLength = typeof data?.readme?.length === 'number' ? data.readme.length : 0;
      if (readmeLength > 5000) score += 40; // Extensive docs
      else if (readmeLength > 2000) score += 30;
      else if (readmeLength > 1000) score += 20;
      else if (readmeLength > 500) score += 10;

      // === PROJECT COMPLEXITY ===
      const complexity = data?.readme?.complexity;
      if (complexity === 'complex') score += 50;
      else if (complexity === 'moderate') score += 25;

      // === QUALITY INDICATORS ===
      // Safe array checks with validation
      const scripts = Array.isArray(data?.packageJson?.scripts) ? data.packageJson.scripts : [];
      if (scripts.some(s => typeof s === 'string' && s.includes('test'))) score += 20; // Has tests
      if (scripts.some(s => typeof s === 'string' && s.includes('build'))) score += 15; // Production build
      if (scripts.some(s => typeof s === 'string' && s.includes('lint'))) score += 10; // Code quality
      if (data?.readme?.hasDocs === true) score += 15; // Documentation
      if (data?.readme?.hasDemo === true) score += 20; // Live deployment
      if (data?.readme?.hasMetrics === true) score += 15; // Measurable impact

      // === DEPENDENCY COUNT (indicates complexity) ===
      const techs = Array.isArray(data?.detectedTechnologies) ? data.detectedTechnologies : [];
      const depCount = techs.length;
      if (depCount > 30) score += 30;
      else if (depCount > 20) score += 20;
      else if (depCount > 10) score += 10;

      // === RECENCY (Recent work is relevant) ===
      // Safe date parsing with validation
      let daysSinceUpdate = Infinity;
      try {
        const updateDate = new Date(repo.updated_at);
        if (!isNaN(updateDate.getTime())) {
          daysSinceUpdate = (Date.now() - updateDate.getTime()) / (1000 * 60 * 60 * 24);
        }
      } catch (dateError) {
        console.warn(`Invalid date for repo ${repo.name}: ${repo.updated_at}`);
      }

      if (daysSinceUpdate < 30) score += 30; // Updated in last month
      else if (daysSinceUpdate < 90) score += 20; // Last 3 months
      else if (daysSinceUpdate < 180) score += 10; // Last 6 months

      // === PUBLIC REPO BONUSES (only if public) ===
      if (repo.private !== true) {
        // Stars indicate community validation (with type safety)
        const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;
        if (stars > 100) score += 50;
        else if (stars > 50) score += 40;
        else if (stars > 20) score += 30;
        else if (stars > 10) score += 20;
        else if (stars > 5) score += 10;

        // Forks indicate usefulness (with type safety)
        const forks = typeof repo.forks_count === 'number' ? repo.forks_count : 0;
        if (forks > 20) score += 30;
        else if (forks > 10) score += 20;
        else if (forks > 5) score += 10;
      }

      // === OWNERSHIP BONUS ===
      // Own repos are more impressive than contributions to org repos
      if (isOwnRepo) {
        score += 30;
      }

      // === MINOR PENALTIES ===
      // Note: Fork/org repo penalties are already applied in the USER CONTRIBUTION ANALYSIS section above
      // to avoid double penalties

      const readmeLen = typeof data?.readme?.length === 'number' ? data.readme.length : 0;
      if (readmeLen === 0) score -= 20; // No README is unprofessional

      // Only penalize low commits for own non-fork repos (forks/org repos already penalized above)
      if (isOwnRepo && !repo.fork && relevantCommits < 5) {
        score -= 20; // Very few commits = trivial project
      }

      // Ensure score is a valid number (but allow negative scores for filtering)
      const finalScore = typeof score === 'number' && !isNaN(score) ? score : -9999;

      return { ...repo, calculatedScore: finalScore };
    })
    .filter(repo => {
      const score = repo.calculatedScore;

      // REMOVE: Repos with very negative scores (0 commits in forks/org repos)
      if (score < -1000) {
        return false;
      }

      // REMOVE: Repos with negative scores unless they're owned by user
      const parts = repo.full_name.split('/');
      const isOwn = parts.length >= 2 && parts[0].toLowerCase().trim() === usernameLower;

      // Keep only if: positive score OR (owned by user AND score >= 0)
      return (typeof score === 'number' && score > 0) || (score >= 0 && isOwn);
    })
    .sort((a, b) => {
      const scoreA = typeof a.calculatedScore === 'number' ? a.calculatedScore : 0;
      const scoreB = typeof b.calculatedScore === 'number' ? b.calculatedScore : 0;
      return scoreB - scoreA;
    });
};