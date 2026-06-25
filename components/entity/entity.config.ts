import { EntityConfig } from './entity.types';
import {
  assertCanAddHouse,
  assertCanAddItem,
  assertCanAddStorageUnit,
  HOUSE_LIMIT_ERROR,
  ITEM_LIMIT_ERROR,
  STORAGE_UNIT_LIMIT_ERROR,
} from '@/utils/limits';

export const ENTITY_CONFIGS = {
  house: {
    type: 'house',
    title: 'House',
    icon: 'home-outline',
    collection: 'houses',

    children: [
      {
        type: 'room',
        label: 'Rooms',
        icon: 'door',
      },
    ],

    fields: [
      { key: 'name', label: 'Name' },
      { key: 'address', label: 'Address', optional: true },
      { key: 'notes', label: 'Notes', optional: true },
    ],

    limits: {
      check: assertCanAddHouse,
      errorMessage: HOUSE_LIMIT_ERROR,
    },
  } satisfies EntityConfig<any>,

  room: {
    type: 'room',
    title: 'Room',
    icon: 'door',
    collection: 'rooms',

    children: [
      {
        type: 'container',
        label: 'Containers',
        icon: 'cupboard-outline',
      },
      {
        type: 'box',
        label: 'Boxes',
        icon: 'archive-outline',
      },
      {
        type: 'item',
        label: 'Items',
        icon: 'shape-outline',
      },
    ],

    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', optional: true },
    ],

    limits: {
      check: assertCanAddStorageUnit,
      errorMessage: STORAGE_UNIT_LIMIT_ERROR,
    },
  } satisfies EntityConfig<any>,

  container: {
    type: 'container',
    title: 'Container',
    icon: 'cupboard-outline',
    collection: 'containers',

    parent: {
      type: 'room',
      required: true,
    },

    children: [
      {
        type: 'box',
        label: 'Boxes',
        icon: 'archive-outline',
      },
      {
        type: 'item',
        label: 'Items',
        icon: 'shape-outline',
      },
    ],

    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', optional: true },
    ],

    limits: {
      check: assertCanAddStorageUnit,
      errorMessage: STORAGE_UNIT_LIMIT_ERROR,
    },
  } satisfies EntityConfig<any>,

  box: {
    type: 'box',
    title: 'Box',
    icon: 'archive-outline',
    collection: 'boxes',

    parent: {
      type: 'container',
      required: false,
    },

    children: [
      {
        type: 'item',
        label: 'Items',
        icon: 'shape-outline',
      },
    ],

    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', optional: true },
    ],

    limits: {
      check: assertCanAddStorageUnit,
      errorMessage: STORAGE_UNIT_LIMIT_ERROR,
    },
  } satisfies EntityConfig<any>,

  item: {
    type: 'item',
    title: 'Item',
    icon: 'shape-outline',
    collection: 'items',

    parent: {
      type: 'room',
      required: true,
    },

    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', optional: true },
      { key: 'tags', label: 'Tags', optional: true },
      { key: 'purchasePrice', label: 'Purchase price', optional: true },
      { key: 'notes', label: 'Notes', optional: true },
    ],

    limits: {
      check: assertCanAddItem,
      errorMessage: ITEM_LIMIT_ERROR,
    },
  } satisfies EntityConfig<any>,
};
