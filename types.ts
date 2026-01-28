export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner?: {
    login: string;
    type: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  forks_count: number;
  topics: string[];
}

export interface EnrichedRepoData extends GitHubRepo {
  calculatedScore?: number; // Smart scoring for ranking repos
  enrichedData?: {
    packageJson?: {
      dependencies: string[];
      devDependencies: string[];
      scripts: string[];
      description?: string;
    } | null;
    pythonDependencies?: string[];
    commitCount?: number; // Total commits in repo
    userCommitCount?: number; // User's commits (for filtering org repos)
    languages?: Record<string, number>;
    languageCount?: number;
    totalCodeBytes?: number;
    readme?: {
      length: number;
      hasDemo: boolean;
      hasDocs: boolean;
      techMentions: string[];
      projectType: string;
      hasMetrics: boolean;
      complexity: 'simple' | 'moderate' | 'complex';
    };
    // ML/Data Science detection
    isMLProject?: boolean;
    isDataScience?: boolean;
    // All detected technologies from all ecosystems
    detectedTechnologies?: string[];
  };
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

export interface ResumeProject {
  id: string;
  name: string;
  description: string[]; // Changed to array for bullet points
  technologies: string[];
  url?: string;           // GitHub repo URL
  homepage?: string;      // Live project URL (if exists)
  isPrivate?: boolean;    // Is private repo?
  stars?: number;
}

export interface ResumeExperience {
  id: string;
  title: string;
  company: string;
  period: string;
  description: string[];
}

export interface ResumeEducation {
  id: string;
  institution: string;
  degree: string;
  location: string;
  period: string;
}

export interface ResumeCertification {
  id: string;
  name: string;
  issuer: string;
  date: string;
  credentialId?: string;
  credentialUrl?: string;
}

export interface ResumeData {
  fullName: string;
  title: string;
  email: string;
  phone?: string;
  githubUrl: string;
  website: string;
  location: string;
  linkedinUrl?: string;
  education: ResumeEducation[];
  certifications?: ResumeCertification[];
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
  };
  projects: ResumeProject[];
  experience: ResumeExperience[];
}

export enum AppState {
  IDLE = 'IDLE',
  FETCHING_GITHUB = 'FETCHING_GITHUB',
  ANALYZING_AI = 'ANALYZING_AI',
  READY = 'READY',
  ERROR = 'ERROR'
}