import { NodeApiError } from 'n8n-workflow';

import { processResponseData, sendErrorPostReceive, encodeBinaryData } from '../GenericFunctions';

describe('Mistral OCR Generic Functions', () => {
	describe('processResponseData', () => {
		it('should return items unchanged if no response body', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = { body: null, statusCode: 200 };
			const result = await processResponseData.call({}, items, response);
			expect(result).toEqual(items);
		});

		it('should process text response correctly', async () => {
			const items = [{ json: { test: 'data' } }];

			const response = {
				body: { text: 'Extracted text content' },
				statusCode: 200,
			};
			const result = await processResponseData.call({}, items, response);
			expect(result[0].json.extractedText).toBe('Extracted text content');
			expect(result[0].json.ocrResult).toEqual({ text: 'Extracted text content' });
		});

		it('should process pages response correctly', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = {
				body: {
					pages: [
						{ markdown: 'Page 1', text: 'Text 1' },
						{ markdown: 'Page 2', text: 'Text 2' },
					],
				},
				statusCode: 200,
			};
			const result = await processResponseData.call({}, items, response);
			expect(result[0].json.extractedText).toBe('Page 1\n\nPage 2');
			expect(result[0].json.pageCount).toBe(2);
		});

		it('should handle processed file in response', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = {
				body: { processed_file: 'base64data' },
				statusCode: 200,
			};
			const result = await processResponseData.call({}, items, response);
			expect(result[0].binary?.processedDocument).toBeDefined();
			expect(result[0].binary?.processedDocument?.data).toBe('base64data');
			expect(result[0].binary?.processedDocument?.mimeType).toBe('application/pdf');
		});
	});

	describe('sendErrorPostReceive', () => {
		it('should return items unchanged if status code is less than 400', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = { statusCode: 200 };
			const result = await sendErrorPostReceive.call(
				{ getNodeParameter: () => 'url' },
				items,
				response,
			);
			expect(result).toEqual(items);
		});

		it('should handle 422 validation error', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = {
				statusCode: 422,
				body: {
					detail: [
						{ loc: ['document_url'], msg: 'Invalid URL format' },
						{ loc: ['model'], msg: 'Invalid model' },
					],
				},
			};

			await expect(
				sendErrorPostReceive.call(
					{ getNodeParameter: () => 'url', getNode: () => ({ name: 'test' }) },
					items,
					response,
				),
			).rejects.toThrow(NodeApiError);
		});

		it('should handle URL access error', async () => {
			const items = [{ json: { test: 'data' } }];
			const response = {
				statusCode: 400,
				body: {
					message: 'Error fetching file from URL',
				},
			};

			await expect(
				sendErrorPostReceive.call(
					{
						getNodeParameter: () => 'url',
						getNode: () => ({ name: 'test' }),
					},
					items,
					response,
				),
			).rejects.toThrow(NodeApiError);
		});
	});

	describe('handleBinaryData', () => {
		it('should format binary data correctly', async () => {
			const mockBinaryData = {
				mimeType: 'application/pdf',
				data: 'test-data',
			};

			const mockContext = {
				getNodeParameter: (param: string) => {
					if (param === 'model') return 'mistral-ocr-latest';
					if (param === 'binaryProperty') return 'data';
					return null;
				},
				helpers: {
					assertBinaryData: () => mockBinaryData,
					getBinaryDataBuffer: async () => Buffer.from('test-data'),
				},
			};

			const requestOptions = {
				body: {},
			};

			const result = await encodeBinaryData.call(mockContext, requestOptions);

			expect(result.body).toEqual({
				model: 'mistral-ocr-latest',
				document: {
					type: 'document_url',
					document_url: 'data:application/pdf;base64,dGVzdC1kYXRh',
				},
			});
		});
	});
});
