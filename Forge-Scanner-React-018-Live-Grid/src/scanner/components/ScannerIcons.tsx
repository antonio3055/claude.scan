import type { SVGProps } from 'react';

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export const UploadIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/></Icon>;
export const MoreIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></Icon>;
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M9 5v14M15 5v14"/></Icon>;
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m8 5 11 7-11 7V5z"/></Icon>;
export const StopIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="1"/></Icon>;
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18.5 6.5L20 8M4 16l1.5 1.5A7 7 0 0 0 17.9 15"/></Icon>;
export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m9 7 5 5-5 5"/></Icon>;
export const SendIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m21 3-7.5 18-3.5-7-7-3.5L21 3z"/><path d="m10 14 4-4"/></Icon>;
export const FileIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/></Icon>;
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 4 3 20h18L12 4z"/><path d="M12 9v5m0 3h.01"/></Icon>;
