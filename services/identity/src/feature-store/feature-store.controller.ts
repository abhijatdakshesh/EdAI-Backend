import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FeatureStoreService } from './feature-store.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('feature-store')
@UseGuards(JwtAuthGuard)
export class FeatureStoreController {
  constructor(private readonly featureStore: FeatureStoreService) {}

  @Get('students')
  getCohort(
    @Query('department') department?: string,
    @Query('semester') semester?: string,
    @Query('limit') limit?: string,
  ) {
    return this.featureStore.getCohortFeatures({
      department,
      semester: semester ? parseInt(semester, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 500,
    });
  }

  @Get('students/:usn')
  getOne(@Param('usn') usn: string) {
    return this.featureStore.getStudentFeatures(usn);
  }
}
