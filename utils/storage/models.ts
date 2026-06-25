export type House = {
  id: string;
  ownerId: string | null;
  name: string;
  address: string | null;
  notes: string | null;
  imagePath: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type Room = {
  id: string;
  houseId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type Container = {
  id: string;
  houseId: string;
  roomId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type Box = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  tags: string;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type Item = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  tags: string;
  purchasePriceCents: number | null;
  notes: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type ItemImage = {
  id: string;
  itemId: string;
  houseId: string;
  imagePath: string | null;
  remotePath: string | null;
  position: number;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type InboxEntry = {
  id: string;
  createdAt: number;
  updatedAt: number;
  source: string;
  rawText: string;
  status: string;
  parsedResultJson: string | null;
  appliedRefsJson: string | null;
  error: string | null;
};
