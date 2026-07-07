export interface User {
    userId: number | string;
    name: string;
    email: string;
    role: string;
    planName?: string;
    signature?: string;
    avatarUrl?: string | null;
}
