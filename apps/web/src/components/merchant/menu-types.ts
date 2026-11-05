/** Menu shapes as GET /api/merchant/:merchantId/menu returns them (centavos for money). */
export interface MenuOptionData {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaCentavos: number;
  readonly isAvailable: boolean;
}

export interface MenuGroupData {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly MenuOptionData[];
}

export interface MenuItemData {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: number;
  readonly isAvailable: boolean;
  readonly photoPath: string | null;
  readonly photoUrl: string | null;
  readonly modifierGroups: readonly MenuGroupData[];
}

export interface MenuCategoryData {
  readonly id: string;
  readonly name: string;
  readonly sort: number;
  readonly items: readonly MenuItemData[];
}
