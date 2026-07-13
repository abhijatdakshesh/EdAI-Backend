import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PredictionService } from './prediction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('predict')
@UseGuards(JwtAuthGuard)
export class PredictionController {
  constructor(private readonly prediction: PredictionService) {}

  @Get('models')
  listModels() {
    return { models: this.prediction.listModels() };
  }

  @Get(':model/students')
  predictCohort(
    @Param('model') model: string,
    @Query('department') department?: string,
    @Query('semester') semester?: string,
    @Query('limit') limit?: string,
  ) {
    return this.prediction.predictForCohort(model, {
      department,
      semester: semester ? parseInt(semester, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 500,
    });
  }

  @Get(':model/students/:usn')
  predictStudent(@Param('model') model: string, @Param('usn') usn: string) {
    return this.prediction.predictForStudent(model, usn);
  }
}
