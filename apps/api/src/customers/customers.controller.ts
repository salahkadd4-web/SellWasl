import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createCustomerSchema,
  type CustomerDto,
  type CustomerHistory,
  customerListQuerySchema,
  type Page,
  updateCustomerSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CustomersService } from './customers.service';

@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('customers.read')
  @Get('customers')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(customerListQuerySchema))
    query: z.output<typeof customerListQuerySchema>,
  ): Promise<Page<CustomerDto>> {
    return this.customers.list(user, query);
  }

  @RequirePermission('customers.create')
  @Post('customers')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: z.output<typeof createCustomerSchema>,
  ): Promise<CustomerDto> {
    return this.customers.create(user, body);
  }

  @RequirePermission('customers.read')
  @Get('customers/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerDto> {
    return this.customers.get(user, id);
  }

  @RequirePermission('customers.read')
  @Get('customers/:id/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerHistory> {
    return this.customers.history(user, id);
  }

  @RequirePermission('customers.update')
  @Patch('customers/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: z.output<typeof updateCustomerSchema>,
  ): Promise<CustomerDto> {
    return this.customers.update(user, id, body);
  }

  @RequirePermission('customers.update')
  @Post('customers/:id/validate')
  @HttpCode(200)
  validate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDto> {
    return this.customers.validate(user, id);
  }

  @RequirePermission('customers.disable')
  @Post('customers/:id/disable')
  @HttpCode(200)
  disable(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDto> {
    return this.customers.setStatus(user, id, 'INACTIVE');
  }

  @RequirePermission('customers.disable')
  @Post('customers/:id/enable')
  @HttpCode(200)
  enable(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDto> {
    return this.customers.setStatus(user, id, 'ACTIVE');
  }
}
