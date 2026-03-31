-- CreateTable
CREATE TABLE `DocumentTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `subtype` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentTemplate_userId_idx`(`userId`),
    INDEX `DocumentTemplate_type_idx`(`type`),
    INDEX `DocumentTemplate_userId_type_idx`(`userId`, `type`),
    INDEX `DocumentTemplate_userId_type_isDefault_idx`(`userId`, `type`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentTemplate` ADD CONSTRAINT `DocumentTemplate_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
