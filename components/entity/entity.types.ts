export type EntityType = 'house' | 'room' | 'container' | 'box' | 'item';

export interface EntityConfig<T> {
  type: EntityType;
  title: string;
  icon: string;
  collection: string;

  parent?: {
    type: EntityType;
    required: boolean;
  };

  children?: {
    type: EntityType;
    label: string;
    icon: string;
  }[];

  fields: {
    key: keyof T;
    label: string;
    optional?: boolean;
  }[];

  limits?: {
    check: () => Promise<void>;
    errorMessage: string;
  };
}
