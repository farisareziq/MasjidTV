export interface Zone {
    zone: string;
    negeri: string;
    label: string;
}
export declare const ZONES: Zone[];
export declare function getZone(code: string): Zone | null;
export declare function getZonesGrouped(): Record<string, Zone[]>;
