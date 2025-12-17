// Application constants

// Resume density thresholds
export const RESUME_DENSITY = {
    ULTRA_COMPACT_THRESHOLD: 40,
    COMPACT_THRESHOLD: 25,
} as const;

// Timing constants
export const TIMING = {
    PRINT_TITLE_DELAY: 100,
    DEBOUNCE_DELAY: 300,
    AI_REQUEST_COOLDOWN: 2000,
} as const;

// GitHub API constants
export const GITHUB_API = {
    BASE_URL: 'https://api.github.com',
    REPOS_PER_PAGE: 100,
    MAX_PAGES: 3,
    MAX_REPOS_FOR_CONTEXT: 50,
    TOP_REPOS_FOR_INITIAL: 20,
} as const;

// Resume scoring
export const RESUME_SCORING = {
    ONE_WEEK_MS: 604800000,
    STAR_WEIGHT_MULTIPLIER: 2,
} as const;

// Print settings
export const PRINT = {
    PAGE_SIZE: 'A4',
    MARGIN_TOP: '12mm',
    MARGIN_RIGHT: '15mm',
    MARGIN_BOTTOM: '12mm',
    MARGIN_LEFT: '15mm',
} as const;

// Validation
export const VALIDATION = {
    MIN_PHONE_LENGTH: 10,
    MAX_PHONE_LENGTH: 15,
    MAX_EMAIL_LENGTH: 254,
    MAX_URL_LENGTH: 2048,
} as const;
