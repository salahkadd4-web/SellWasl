import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type BonusRuleDto,
  bonusRuleSchema,
  createProductSchema,
  createUnitSchema,
  createVariantSchema,
  type PriceGrid,
  priceGridSchema,
  type PriceTierDto,
  priceTierSchema,
  type ProductCategoryDto,
  productCategorySchema,
  type ProductDto,
  productListQuerySchema,
  type ProductRangeDto,
  productRangeSchema,
  type SimulatedCart,
  simulateCartSchema,
  updateBonusRuleSchema,
  updatePriceTierSchema,
  updateProductSchema,
  updateUnitSchema,
  updateVariantSchema,
} from '@sellwasl/validation';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();
const productQuerySchema = z.object({ productId: z.uuid().optional() });

/** Catalogue et prix (docs/api.md §5.2, UC-81). */
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
  ) {}

  // Gammes et catégories

  @RequirePermission('products.read')
  @Get('product-ranges')
  ranges(): Promise<ProductRangeDto[]> {
    return this.catalog.ranges();
  }

  @RequirePermission('products.write')
  @Post('product-ranges')
  createRange(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(productRangeSchema)) body: Out<typeof productRangeSchema>,
  ): Promise<ProductRangeDto> {
    return this.catalog.createRange(user, body);
  }

  @RequirePermission('products.write')
  @Patch('product-ranges/:id')
  updateRange(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(productRangeSchema.partial()))
    body: Partial<Out<typeof productRangeSchema>>,
  ): Promise<ProductRangeDto> {
    return this.catalog.updateRange(user, id, body);
  }

  @RequirePermission('products.read')
  @Get('product-categories')
  categories(): Promise<ProductCategoryDto[]> {
    return this.catalog.categories();
  }

  @RequirePermission('products.write')
  @Post('product-categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(productCategorySchema)) body: Out<typeof productCategorySchema>,
  ): Promise<ProductCategoryDto> {
    return this.catalog.createCategory(user, body);
  }

  @RequirePermission('products.write')
  @Patch('product-categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(productCategorySchema.partial()))
    body: Partial<Out<typeof productCategorySchema>>,
  ): Promise<ProductCategoryDto> {
    return this.catalog.updateCategory(user, id, body);
  }

  // Produits, conditionnements, parfums

  @RequirePermission('products.read')
  @Get('products')
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: Out<typeof productListQuerySchema>,
  ): Promise<ProductDto[]> {
    return this.catalog.list(query);
  }

  @RequirePermission('products.write')
  @Post('products')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProductSchema)) body: Out<typeof createProductSchema>,
  ): Promise<ProductDto> {
    return this.catalog.create(user, body);
  }

  @RequirePermission('products.read')
  @Get('products/:id')
  get(@Param('id', uuid) id: string): Promise<ProductDto> {
    return this.catalog.get(id);
  }

  @RequirePermission('products.write')
  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: Out<typeof updateProductSchema>,
  ): Promise<ProductDto> {
    return this.catalog.update(user, id, body);
  }

  @RequirePermission('products.write')
  @Post('products/:id/units')
  addUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createUnitSchema)) body: Out<typeof createUnitSchema>,
  ): Promise<ProductDto> {
    return this.catalog.addUnit(user, id, body);
  }

  @RequirePermission('products.write')
  @Patch('products/:id/units/:unitId')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('unitId', uuid) unitId: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) body: Out<typeof updateUnitSchema>,
  ): Promise<ProductDto> {
    return this.catalog.updateUnit(user, id, unitId, body);
  }

  @RequirePermission('products.write')
  @Post('products/:id/variants')
  addVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createVariantSchema)) body: Out<typeof createVariantSchema>,
  ): Promise<ProductDto> {
    return this.catalog.addVariant(user, id, body);
  }

  @RequirePermission('products.write')
  @Patch('products/:id/variants/:variantId')
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('variantId', uuid) variantId: string,
    @Body(new ZodValidationPipe(updateVariantSchema)) body: Out<typeof updateVariantSchema>,
  ): Promise<ProductDto> {
    return this.catalog.updateVariant(user, id, variantId, body);
  }

  // Prix, paliers, bonus

  @RequirePermission('prices.read')
  @Get('products/:id/prices')
  prices(@Param('id', uuid) id: string): Promise<PriceGrid> {
    return this.pricing.grid(id);
  }

  @RequirePermission('prices.update')
  @Put('products/:id/prices')
  putPrices(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(priceGridSchema)) body: Out<typeof priceGridSchema>,
  ): Promise<PriceGrid> {
    return this.pricing.putGrid(user, id, body);
  }

  @RequirePermission('prices.read')
  @Get('price-tiers')
  tiers(
    @Query(new ZodValidationPipe(productQuerySchema)) query: Out<typeof productQuerySchema>,
  ): Promise<PriceTierDto[]> {
    return this.pricing.tiers(query.productId);
  }

  @RequirePermission('price_tiers.update')
  @Post('price-tiers')
  createTier(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(priceTierSchema)) body: Out<typeof priceTierSchema>,
  ): Promise<PriceTierDto> {
    return this.pricing.createTier(user, body);
  }

  @RequirePermission('price_tiers.update')
  @Patch('price-tiers/:id')
  updateTier(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updatePriceTierSchema)) body: Out<typeof updatePriceTierSchema>,
  ): Promise<PriceTierDto> {
    return this.pricing.updateTier(user, id, body);
  }

  @RequirePermission('price_tiers.update')
  @Delete('price-tiers/:id')
  @HttpCode(204)
  deleteTier(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.pricing.deleteTier(user, id);
  }

  @RequirePermission('prices.read')
  @Get('bonus-rules')
  bonusRules(): Promise<BonusRuleDto[]> {
    return this.pricing.bonusRules();
  }

  @RequirePermission('bonuses.update')
  @Post('bonus-rules')
  createBonus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bonusRuleSchema)) body: Out<typeof bonusRuleSchema>,
  ): Promise<BonusRuleDto> {
    return this.pricing.createBonus(user, body);
  }

  @RequirePermission('bonuses.update')
  @Patch('bonus-rules/:id')
  updateBonus(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateBonusRuleSchema)) body: Out<typeof updateBonusRuleSchema>,
  ): Promise<BonusRuleDto> {
    return this.pricing.updateBonus(user, id, body);
  }

  @RequirePermission('bonuses.update')
  @Delete('bonus-rules/:id')
  @HttpCode(204)
  deleteBonus(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.pricing.deleteBonus(user, id);
  }

  @RequirePermission('prices.read')
  @Post('pricing/simulate')
  @HttpCode(200)
  simulate(
    @Body(new ZodValidationPipe(simulateCartSchema)) body: Out<typeof simulateCartSchema>,
  ): Promise<SimulatedCart> {
    return this.pricing.simulate(body);
  }
}
