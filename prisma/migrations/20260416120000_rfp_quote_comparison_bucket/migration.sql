-- CreateEnum
CREATE TYPE "RfpQuoteComparisonBucket" AS ENUM ('ELECTRIC_FIXED_CAPACITY_ADJUST', 'ELECTRIC_CAPACITY_PASS_THROUGH');

-- AlterTable
ALTER TABLE "rfp_quotes" ADD COLUMN "comparison_bucket" "RfpQuoteComparisonBucket";
