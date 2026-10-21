import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ChevronDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Svg>
);
export const LockIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);
export const BoltIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </Svg>
);
export const DeviceIcon = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="2.8" width="10" height="18.4" rx="2.2" />
    <path d="M11 18.2h2" />
  </Svg>
);
export const SunIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </Svg>
);
export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
);
export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" />
    <path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
  </Svg>
);
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" />
  </Svg>
);
export const ArrowLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
  </Svg>
);
export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </Svg>
);
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.1" />
  </Svg>
);
export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8Z" />
  </Svg>
);
export const LayersIcon = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);
export const GearIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);
export const HelpIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17v.1" />
  </Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ArrowUpIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5m0 0-6 6m6-6 6 6" />
  </Svg>
);
export const ArrowDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14m0 0-6-6m6 6 6-6" />
  </Svg>
);
export const SlidersIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
);
export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" />
  </Svg>
);
export const StopIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);
export const GripIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </Svg>
);
export const ArchiveIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
  </Svg>
);
export const ImagesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-8 8" />
  </Svg>
);
