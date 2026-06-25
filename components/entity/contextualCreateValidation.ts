import type { EntityConfig, EntityType } from './entity.types';

type ContextualCreateValidationInput = {
  config: EntityConfig<any>;
  type: EntityType;
  values: Record<string, string>;
  houseId: string;
  parentType: EntityType | '';
  parentId: string;
};

export function getContextualCreateValidationError({
  config,
  type,
  values,
  houseId,
  parentType,
  parentId,
}: ContextualCreateValidationInput): string | null {
  const missingField = config.fields.find(
    (field) => !field.optional && !values[String(field.key)]?.trim()
  );
  if (missingField) {
    return `${missingField.label} is required`;
  }

  if (type !== 'house' && !houseId) {
    return 'House selection is required';
  }

  if (
    config.parent?.required &&
    ((!parentType && type !== 'container') || !parentId)
  ) {
    return 'Parent selection is required';
  }

  return null;
}
