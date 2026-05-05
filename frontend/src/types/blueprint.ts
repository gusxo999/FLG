/**
 * TypeScript types matching the Factorio Blueprint JSON format.
 * Reference: https://wiki.factorio.com/Blueprint_string_format
 */

export interface BlueprintPosition {
  x: number;
  y: number;
}

export interface BlueprintColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ItemFilter {
  name: string;
  index: number;
}

export interface InfinityFilter {
  name: string;
  count: number;
  mode: 'at-least' | 'at-most' | 'exactly';
  index: number;
}

export interface InfinitySettings {
  remove_unfiltered_items: boolean;
  filters?: InfinityFilter[];
}

export interface ArithmeticCondition {
  first_signal?: SignalID;
  second_signal?: SignalID;
  constant?: number;
  second_constant?: number;
  operation: '+' | '-' | '*' | '/' | '%' | '^' | '<<' | '>>' | 'AND' | 'OR' | 'XOR';
  output_signal?: SignalID;
}

export interface DeciderCondition {
  first_signal?: SignalID;
  second_signal?: SignalID;
  constant?: number;
  comparator: '<' | '>' | '=' | '>=' | '<=' | '!=';
  output_signal?: SignalID;
  copy_count_from_input?: boolean;
}

export interface ControlBehavior {
  arithmetic_conditions?: ArithmeticCondition;
  decider_conditions?: DeciderCondition;
  circuit_close_gate?: boolean;
  circuit_read_sensor?: boolean;
  output_signal?: SignalID;
  circuit_contents_read_mode?: number;
  input_signal?: SignalID;
  circuit_mode?: number;
  circuit_read_hand_contents?: boolean;
  circuit_open_gate?: boolean;
  circuit_enable_disable?: boolean;
  logistic_condition?: DeciderCondition;
  connect_to_logistic_network?: boolean;
  circuit_condition?: DeciderCondition;
}

export interface SignalID {
  name: string;
  type: 'item' | 'fluid' | 'virtual';
}

export interface Signal {
  signal: SignalID;
  count: number;
}

export interface ConnectionPoint {
  red?: ConnectionData[];
  green?: ConnectionData[];
}

export interface ConnectionData {
  entity_id: number;
  circuit_id?: number;
}

export interface EntityConnections {
  '1'?: ConnectionPoint;
  '2'?: ConnectionPoint;
}

export interface SpeakerParameter {
  playback_volume: number;
  playback_globally: boolean;
  allow_polyphony: boolean;
}

export interface SpeakerAlertParameter {
  show_alert: boolean;
  show_on_map: boolean;
  icon_signal_id?: SignalID;
  alert_message: string;
}

/**
 * Factorio 2.0 BlueprintInsertPlan — modules / fuel / 인벤토리 아이템 표현.
 * (Factorio 1.x의 `items: Record<string, number>` 와는 다른 새 포맷)
 */
export interface BlueprintInsertPlan {
  id: { name: string; quality?: string };
  items: {
    in_inventory?: Array<{
      inventory: number;     // defines.inventory.* 정수
      stack: number;         // 0-based slot index
      count?: number;
    }>;
    grid_count?: number;
  };
}

export interface BlueprintEntity {
  entity_number: number;
  name: string;
  position: BlueprintPosition;
  /**
   * Factorio 2.0 16-방향 인코딩. 0=N, 4=E, 8=S, 12=W (cardinal).
   * 사이값(1,2,3,5,...) 은 22.5° / 45° 단위 sub-cardinal — 주로 곡선 레일.
   * 1.x 블루프린트(0..7)는 import 시 ×2 로 업그레이드.
   */
  direction?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  connections?: EntityConnections;
  control_behavior?: ControlBehavior;
  /** Factorio 2.0 형식 (modules / fuel / 인벤토리 아이템) */
  items?: BlueprintInsertPlan[];
  /** Space Age 엔티티 quality */
  quality?: string;
  /** 좌우 거울 (일부 비대칭 엔티티) */
  mirror?: boolean;
  /** 임의 사용자 메타 (passthrough) */
  tags?: Record<string, unknown>;
  recipe?: string;
  bar?: number;
  inventory?: {
    filters?: ItemFilter[];
    bar?: number;
  };
  infinity_settings?: InfinitySettings;
  type?: 'input' | 'output' | 'input-output';
  input_priority?: 'right' | 'left';
  output_priority?: 'right' | 'left';
  filter?: string;
  filters?: ItemFilter[];
  filter_mode?: 'whitelist' | 'blacklist';
  override_stack_size?: number;
  drop_position?: BlueprintPosition;
  pickup_position?: BlueprintPosition;
  request_filters?: ItemFilter[];
  request_from_buffers?: boolean;
  parameters?: SpeakerParameter;
  alert_parameters?: SpeakerAlertParameter;
  auto_launch?: boolean;
  variation?: number;
  color?: BlueprintColor;
  station?: string;
  manual_trains_limit?: number;
  switch_state?: boolean;
}

export interface BlueprintTile {
  name: string;
  position: BlueprintPosition;
}

export interface BlueprintIcon {
  index: 1 | 2 | 3 | 4;
  signal: SignalID;
}

export interface Blueprint {
  item: 'blueprint';
  label?: string;
  label_color?: BlueprintColor;
  entities?: BlueprintEntity[];
  tiles?: BlueprintTile[];
  icons?: BlueprintIcon[];
  schedules?: unknown[];
  description?: string;
  /** Factorio version as a 64-bit integer encoded as number */
  version: number;
  'snap-to-grid'?: BlueprintPosition;
  'absolute-snapping'?: boolean;
  'position-relative-to-grid'?: BlueprintPosition;
}

export interface BlueprintBookEntry {
  blueprint: Blueprint;
  index: number;
}

export interface BlueprintBook {
  item: 'blueprint-book';
  label?: string;
  label_color?: BlueprintColor;
  blueprints: BlueprintBookEntry[];
  active_index: number;
  description?: string;
  version: number;
}

/**
 * The outer wrapper that gets serialized. The key is always '0'.
 */
export interface BlueprintWrapper {
  blueprint?: Blueprint;
  'blueprint-book'?: BlueprintBook;
}
