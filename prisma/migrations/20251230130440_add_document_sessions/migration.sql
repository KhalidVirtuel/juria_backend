-- CreateTable
CREATE TABLE `document_generation_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `folderId` INTEGER NULL,
    `documentType` VARCHAR(50) NOT NULL,
    `collectedData` JSON NULL,
    `requiredFields` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'collecting',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `document_generation_sessions_conversationId_idx`(`conversationId`),
    INDEX `document_generation_sessions_userId_idx`(`userId`),
    INDEX `document_generation_sessions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `document_generation_sessions` ADD CONSTRAINT `document_generation_sessions_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_generation_sessions` ADD CONSTRAINT `document_generation_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_generation_sessions` ADD CONSTRAINT `document_generation_sessions_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `Folder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
