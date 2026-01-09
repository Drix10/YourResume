// Input validation and sanitization utilities

export const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
    if (!phone || phone.trim().length === 0) return false;

    // Remove all non-digit characters except + at the start
    const cleaned = phone.replace(/[^\d+]/g, '');

    // Must have at least 7 digits (shortest valid phone) and at most 15 (E.164 max)
    const digitCount = cleaned.replace(/\D/g, '').length;
    if (digitCount < 7 || digitCount > 15) return false;

    // Accepts formats: +1234567890, (123) 456-7890, 123-456-7890, etc.
    const phoneRegex = /^[\+]?[0-9]{1,4}[-.\s]?[(]?[0-9]{1,4}[)]?[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}$/;
    return phoneRegex.test(phone.trim());
};

export const isValidUrl = (url: string): boolean => {
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
};

export const sanitizeUrl = (url: string): string => {
    if (!url || typeof url !== 'string') return '';

    const trimmed = url.trim();
    if (!trimmed) return '';

    // Remove javascript: and data: protocols (XSS prevention)
    const lowerUrl = trimmed.toLowerCase();
    if (lowerUrl.startsWith('javascript:') ||
        lowerUrl.startsWith('data:') ||
        lowerUrl.startsWith('vbscript:') ||
        lowerUrl.startsWith('file:')) {
        return '';
    }

    // Ensure URL starts with http:// or https://
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return `https://${trimmed}`;
    }

    return trimmed;
};

export const sanitizeText = (text: string): string => {
    if (!text) return '';

    // Remove any HTML tags
    return text.replace(/<[^>]*>/g, '');
};

export const validateResumeData = (data: Partial<{
    email: string;
    phone: string;
    githubUrl: string;
    linkedinUrl: string;
    website: string;
}>): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Only validate if field has non-empty content
    const trimmedEmail = data.email?.trim();
    const trimmedPhone = data.phone?.trim();
    const trimmedGithub = data.githubUrl?.trim();
    const trimmedLinkedin = data.linkedinUrl?.trim();
    const trimmedWebsite = data.website?.trim();

    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
        errors.push('Invalid email format');
    }

    if (trimmedPhone && !isValidPhone(trimmedPhone)) {
        errors.push('Invalid phone format (expected 7-15 digits)');
    }

    if (trimmedGithub && !isValidUrl(trimmedGithub)) {
        errors.push('Invalid GitHub URL');
    }

    if (trimmedLinkedin && !isValidUrl(trimmedLinkedin)) {
        errors.push('Invalid LinkedIn URL');
    }

    if (trimmedWebsite && !isValidUrl(trimmedWebsite)) {
        errors.push('Invalid website URL');
    }

    return {
        valid: errors.length === 0,
        errors
    };
};
